/**
 * 迁移脚本：agent 上下文与记忆架构重构(U6 配套)。
 *
 * 背景:U1–U6 把 agent 模块从"加新不删旧"渐进结构,收敛到新的两分架构
 *   (业务对话原文分段 agent_sessions + agent 记忆 agent_lux_memories)。
 *   旧字段/旧类型已从代码删除,残留的旧数据需一次性迁移到新结构。
 *
 * 注意:生产环境 agent_sessions / agent_lux_memories 基本为空,迁移负担极小;
 *   本脚本主要为"曾在渐进期产生过旧结构数据"的环境兜底。可重复执行(幂等)。
 *
 * 运行方式:
 *   cd server && npx ts-node --esm src/scripts/migrate-agent-context-2026-05.ts
 *   (或) cd server && npx ts-node -r tsconfig-paths/register src/scripts/migrate-agent-context-2026-05.ts
 *
 * 前置条件:
 * - 设置好与生产一致的环境变量:MONGO_HOST/MONGO_PORT/MONGO_USER/MONGO_PASSWORD/MONGO_DATABASE
 * - 或直接设 MONGO_URI
 *
 * 迁移内容:
 * 1. agent_lux_memories:type='project' → 'user',agentKey=null
 *    (project 记忆类型已废弃,归并入所有者画像 user)
 * 2. agent_sessions 旧结构(含 sessionKey + messages 数组 + summary + totalRounds + tasks):
 *    - sessionKey 的值写入 agentKey、补 segIndex=0(旧单文档即第 0 段)
 *    - tasks 非空 → 迁到该 agentKey 的 session 记忆记录(agent_lux_memories)
 *    - summary 直接丢弃(取舍说明见下方 STEP 2 注释)
 *    - 删除旧字段 sessionKey / summary / totalRounds / tasks
 *
 * 幂等性保证:
 * - STEP 1:只更 type='project' 的文档;迁过的已是 'user',不再命中
 * - STEP 2:只处理"还带 sessionKey 字段"的旧文档;迁过的旧字段已删,不再命中
 *   tasks 迁移用 upsert(by type+agentKey),重复执行覆盖同值,不产生重复记录
 */

import mongoose, { Types } from 'mongoose';

// ─── 连接配置(与 migrate-frontmatter.ts 一致) ───────────────────────────────
const MONGO_URI =
  process.env.MONGO_URI ??
  (() => {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = process.env.MONGO_PORT ?? '27017';
    const user = process.env.MONGO_USER ?? '';
    const password = process.env.MONGO_PASSWORD ?? '';
    const database = process.env.MONGO_DATABASE ?? 'liminal_field';
    const authSource = 'admin';

    if (user && password) {
      return `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=${authSource}`;
    }
    return `mongodb://${host}:${port}/${database}`;
  })();

// ─── 旧文档类型(只声明迁移涉及的字段) ────────────────────────────────────────

/** agent_sessions 旧结构(渐进期产生),只取迁移需要的字段。 */
interface OldSessionDoc {
  _id: Types.ObjectId;
  /** 旧的会话标识——迁移后写入 agentKey */
  sessionKey?: string;
  /** 新字段:可能已部分迁移 */
  agentKey?: string | null;
  segIndex?: number;
  messages?: Record<string, unknown>[];
  /** 旧字段:对话摘要,迁移时丢弃 */
  summary?: string;
  /** 旧字段:轮数,迁移时丢弃 */
  totalRounds?: number;
  /** 旧字段:写作计划,迁移到 session 记忆记录 */
  tasks?: Array<Record<string, unknown>>;
  createdAt?: Date;
  lastActiveAt?: Date;
}

/** agent_lux_memories 文档,只取迁移需要的字段。 */
interface MemoryDoc {
  _id: Types.ObjectId;
  type: string;
  agentKey?: string | null;
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('连接 MongoDB:', MONGO_URI.replace(/:([^:@]+)@/, ':***@'));
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB 连接成功\n');

  // 直接操作底层集合,不经 Typegoose schema(迁移脚本不依赖 NestJS 模块)
  const db = mongoose.connection.db!;
  const memoryCol = db.collection<MemoryDoc>('agent_lux_memories');
  const sessionCol = db.collection<OldSessionDoc>('agent_sessions');

  // ─── STEP 1:project 记忆 → user ───
  // project 类型已从模型删除;残留 project 记忆归并入 user(所有者画像),agentKey 清空。
  // 幂等:迁过的已是 user,$set type='user' 的过滤条件 type='project' 不再命中。
  const step1 = await memoryCol.updateMany(
    { type: 'project' },
    { $set: { type: 'user', agentKey: null } },
  );
  console.log(`STEP 1: project 记忆 → user,迁移 ${step1.modifiedCount} 条`);

  // ─── STEP 2:agent_sessions 旧结构 → 新分段结构 ───
  // 旧文档判定:still 带 sessionKey 字段(新结构文档无此字段)。
  // 迁移动作:
  //   - sessionKey 的值写入 agentKey(若 agentKey 还没值)、补 segIndex=0
  //   - tasks 非空 → upsert 到该 agentKey 的 session 记忆(agent_lux_memories)
  //   - summary 丢弃:取舍说明——
  //       新架构里"对话脉络"的归宿是 session 记忆 content,由 compaction 在线提炼;
  //       旧 summary 是历史轮数触发产物,语义/质量与新提炼口径不一致,且生产数据基本为空,
  //       直接弃比硬塞进 session content 更干净(避免污染新脉络),需要原文时对话原文仍完整保留。
  //   - 删除旧字段 sessionKey/summary/totalRounds/tasks
  const oldSessions = await sessionCol
    .find({ sessionKey: { $exists: true } })
    .toArray();
  console.log(
    `STEP 2: 找到带 sessionKey 的旧 session 文档 ${oldSessions.length} 个`,
  );

  let sessionsMigrated = 0;
  let tasksMigrated = 0;

  for (const doc of oldSessions) {
    const agentKey = doc.agentKey ?? doc.sessionKey;
    if (!agentKey) {
      // 既无 agentKey 又无 sessionKey 值(异常数据),只清旧字段,跳过 agentKey 赋值
      await sessionCol.updateOne(
        { _id: doc._id },
        {
          $unset: { sessionKey: '', summary: '', totalRounds: '', tasks: '' },
        },
      );
      continue;
    }

    // 2a. tasks 非空 → 迁到该 agentKey 的 session 记忆(upsert by type+agentKey,幂等)
    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    if (tasks.length > 0) {
      const now = new Date();
      await memoryCol.updateOne(
        { type: 'session', agentKey },
        {
          $set: { tasks, updatedAt: now },
          $setOnInsert: {
            type: 'session',
            agentKey,
            // title 固定占位:满足 title 全局 unique,session 唯一性靠 agentKey
            title: `session:${agentKey}`,
            content: '',
            createdAt: now,
          },
        },
        { upsert: true },
      );
      tasksMigrated++;
    }

    // 2b. agentKey/segIndex 补齐 + 删除旧字段
    await sessionCol.updateOne(
      { _id: doc._id },
      {
        $set: {
          agentKey,
          segIndex: typeof doc.segIndex === 'number' ? doc.segIndex : 0,
        },
        $unset: { sessionKey: '', summary: '', totalRounds: '', tasks: '' },
      },
    );
    sessionsMigrated++;
  }

  console.log(
    `STEP 2: session 文档迁移 ${sessionsMigrated} 个,其中 tasks 迁入记忆 ${tasksMigrated} 个`,
  );

  console.log('\n=== 迁移完成 ===');
  await mongoose.disconnect();
  console.log('MongoDB 连接已关闭');
}

main().catch((err: unknown) => {
  console.error('迁移失败:', err);
  process.exit(1);
});
