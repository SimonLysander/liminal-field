/**
 * 迁移脚本:记忆架构 CRUD → event log(2026-05-30,#150 续)。
 *
 * 背景:
 * - 旧 user 记忆是 key-value(`{title unique, content}`),通过 remember 工具 upsert / forget 工具 hard delete。
 * - 新架构是 append-only event log:`agent_memory_observations`,**永远不 update 不 delete**;
 *   memory observer 在 onAfterChat 钩子自动塑形,主 agent 不再持有 remember/forget 工具。
 *
 * 这个脚本:
 * 1. 读现有 user 记忆 (type='user') 全部条目
 * 2. 把每条转成一条 observation(observedAt 用今天日期作为锚点)
 *    - context = `迁移自旧 user 记忆「<title>」`(让后续看得到来源)
 *    - topic = 简单关键词规则分类(observer 后续 LLM 派生 view 时会基于全量再做认知)
 *    - observation = 旧 content
 * 3. 不删旧 user 记忆(冻结作历史快照);代码层已不再写
 *
 * 幂等性:
 * - 写入前先查 observations 表:如果已有 context 以 "迁移自旧 user 记忆" 开头的条目,跳过(已迁过)
 *
 * 运行:
 *   cd server && npx ts-node --esm src/scripts/migrate-memory-event-log-2026-05-30.ts
 *   (与 migrate-agent-context-2026-05.ts 同接法)
 */

import mongoose from 'mongoose';

// ─── 连接配置 ───────────────────────────────────────────────────────
const MONGO_URI =
  process.env.MONGO_URI ??
  (() => {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = process.env.MONGO_PORT ?? '27017';
    const user = process.env.MONGO_USER ?? '';
    const password = process.env.MONGO_PASSWORD ?? '';
    const db = process.env.MONGO_DATABASE ?? 'liminal_field';
    const auth = user && password ? `${user}:${password}@` : '';
    return `mongodb://${auth}${host}:${port}/${db}?authSource=admin`;
  })();

type Topic = 'identity' | 'personality' | 'aesthetic' | 'method' | 'other';

/**
 * 简单关键词规则分类——不调 LLM,把现有 11 条左右记忆落入合理的 topic。
 * observer 后续 LLM 派生 current_view 时会基于这些 + 未来观察重新认知,不需要完美分类。
 */
function classifyTopicByKeywords(title: string, content: string): Topic {
  const text = `${title} ${content}`.toLowerCase();
  const has = (keywords: string[]) => keywords.some((k) => text.includes(k));

  if (
    has([
      '职业',
      '工作',
      '岗位',
      '雇主',
      '居住',
      '在杭州',
      '在北京',
      '在上海',
      '学校',
      '教育',
      '本科',
      '硕士',
      '专业',
      '语言',
      '双语',
      '国籍',
      '工程师',
      '设计师',
      '分析师',
      '产品经理',
    ])
  ) {
    return 'identity';
  }
  if (
    has([
      '性格',
      '价值观',
      '思维',
      '情绪',
      '敏感',
      '内向',
      '外向',
      '焦虑',
      '心境',
      '坚韧',
      '谨慎',
      '认为',
      '相信',
      '在意',
    ])
  ) {
    return 'personality';
  }
  if (
    has([
      '偏好',
      '喜欢',
      '审美',
      '品味',
      '风格',
      '简洁',
      '极简',
      '冷峻',
      '抒情',
      '黑白',
      '留白',
    ])
  ) {
    return 'aesthetic';
  }
  if (
    has([
      '方法',
      '流程',
      '学习',
      '写作',
      '思考',
      '工具',
      '编辑器',
      '草稿',
      '节奏',
      '晨型',
      '夜猫',
      '测试驱动',
      '系统思考',
      '一阶原理',
      '费曼',
    ])
  ) {
    return 'method';
  }
  return 'other';
}

async function main() {
  console.log('[migrate-memory-event-log] 连接 mongo …');
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('mongo db not available');

  const oldMemories = db.collection('agent_lux_memories');
  const observations = db.collection('agent_memory_observations');

  console.log('[migrate] 1. 检查幂等性(若 observations 已有迁移记录 → 跳过)');
  const alreadyMigrated = await observations.countDocuments({
    context: { $regex: /^迁移自旧 user 记忆/ },
  });
  if (alreadyMigrated > 0) {
    console.log(`[migrate] 已迁移 ${alreadyMigrated} 条,无需重跑;退出。`);
    await mongoose.disconnect();
    return;
  }

  console.log('[migrate] 2. 读旧 user 记忆 …');
  const userMemories = await oldMemories.find({ type: 'user' }).toArray();
  console.log(`[migrate]    共 ${userMemories.length} 条`);

  if (userMemories.length === 0) {
    console.log('[migrate] 无旧记忆需要迁移,退出');
    await mongoose.disconnect();
    return;
  }

  console.log('[migrate] 3. 关键词规则分类 + 转 observation …');
  const now = new Date();
  const docs = userMemories.map((m) => {
    const title = (m.title as string) ?? '';
    const content = (m.content as string) ?? '';
    return {
      observedAt: now,
      topic: classifyTopicByKeywords(title, content),
      observation: content,
      context: `迁移自旧 user 记忆「${title}」`,
    };
  });

  console.log('[migrate] 4. 写入 observations(batch insert)…');
  const result = await observations.insertMany(docs);
  console.log(`[migrate]    新增 ${result.insertedCount} 条`);

  // 统计 topic 分布
  const byTopic: Record<string, number> = {};
  for (const d of docs) {
    byTopic[d.topic] = (byTopic[d.topic] ?? 0) + 1;
  }
  console.log('[migrate] 5. topic 分布:', byTopic);

  console.log(
    '[migrate] 完成。旧 user 记忆已冻结(代码不再写),观察者会在下一轮对话开始 append 新观察 + 派生 current_view。',
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[migrate-memory-event-log] 失败:', err);
  process.exit(1);
});
