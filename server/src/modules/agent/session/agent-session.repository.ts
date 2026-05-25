import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { getModelToken } from 'nestjs-typegoose';
import { AgentSession } from './agent-session.entity';

/**
 * 单段软上限：14MB，留 buffer 给 16MB MongoDB 硬上限。
 * 接近此值时 appendMessages 自动开下一段，用户无感。
 * messages append-only：永不删，只追加或开新段（分段是唯一的"超出"处理路径）。
 */
const SEG_SOFT_LIMIT_BYTES = 14 * 1024 * 1024;

/**
 * AgentSessionRepository — 会话的存取层。
 *
 * 只做数据读写，不含业务逻辑（compaction 逻辑在 service 层）。
 *
 * 分段设计：MongoDB 单文档 16MB 上限，长对话 messages append-only 会撞上限。
 * 同一 agentKey 按 segIndex 分段，前端跨段聚合，write 路径通过 appendMessages
 * 自动管理分段，read 路径通过 getAllMessages / getRecentMessages 跨段组装。
 */
@Injectable()
export class AgentSessionRepository {
  private readonly logger = new Logger(AgentSessionRepository.name);

  constructor(
    @Inject(getModelToken(AgentSession.name))
    private readonly sessionModel: ReturnModelType<typeof AgentSession>,
  ) {}

  /** 按 sessionKey 查找会话，不存在返回 null */
  async findByKey(sessionKey: string): Promise<AgentSession | null> {
    return this.sessionModel.findOne({ sessionKey });
  }

  /** 保存会话消息 + 轮数（每次 AI 回复完成后调用） */
  async upsert(
    sessionKey: string,
    messages: Record<string, unknown>[],
    totalRounds: number,
  ): Promise<AgentSession> {
    const now = new Date();
    const result = await this.sessionModel.findOneAndUpdate(
      { sessionKey },
      {
        $set: { messages, totalRounds, lastActiveAt: now },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          summary: '',
          createdAt: now,
        },
      },
      { upsert: true, new: true },
    );
    return result;
  }

  /** compaction 后更新：新摘要 + 裁剪后的消息 + 轮数 */
  async updateAfterCompaction(
    sessionKey: string,
    summary: string,
    messages: Record<string, unknown>[],
    totalRounds: number,
  ): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionKey },
      { $set: { summary, messages, totalRounds, lastActiveAt: new Date() } },
    );
  }

  /** 添加一个 task 到 session 的 tasks 数组 */
  async addTask(
    sessionKey: string,
    task: Record<string, unknown>,
  ): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionKey },
      { $push: { tasks: task } },
    );
  }

  /** 更新 session 中某个 task 的字段（按 task id 匹配）。返回是否命中(任务存在)。 */
  async updateTask(
    sessionKey: string,
    taskId: string,
    updates: Record<string, unknown>,
  ): Promise<boolean> {
    const setFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      setFields[`tasks.$.${key}`] = value;
    }
    const res = await this.sessionModel.updateOne(
      { sessionKey, 'tasks.id': taskId },
      { $set: setFields },
    );
    return res.matchedCount > 0;
  }

  /** 整体替换 session 的 tasks 数组(TodoWrite:模型每次给完整清单) */
  async setTasks(
    sessionKey: string,
    tasks: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.sessionModel.updateOne({ sessionKey }, { $set: { tasks } });
  }

  /** 获取 session 的 tasks 列表 */
  async getTasks(sessionKey: string): Promise<Array<Record<string, unknown>>> {
    const session = await this.sessionModel.findOne(
      { sessionKey },
      { tasks: 1 },
    );
    return (session?.tasks as unknown as Array<Record<string, unknown>>) ?? [];
  }

  /** 删除指定会话 */
  async deleteByKey(sessionKey: string): Promise<void> {
    await this.sessionModel.deleteOne({ sessionKey });
  }

  // ─── 分段读写（新架构：agentKey + segIndex） ────────────────────────────────

  /**
   * 取某 agentKey 最新段（segIndex 最大），无则返回 null。
   * 用于 appendMessages 决策：是否需要开新段。
   */
  async findLatestSeg(agentKey: string): Promise<AgentSession | null> {
    return this.sessionModel.findOne({ agentKey }).sort({ segIndex: -1 });
  }

  /**
   * 追加消息到最新段；最新段不存在则建 seg0；
   * 最新段大小接近 16MB 软上限（14MB）则自动开下一段，用户无感。
   *
   * append-only 原则：messages 只追加，永不删除。
   * 旧消息靠 getRecentMessages 的 limit 裁剪，不靠删 DB 数据。
   */
  async appendMessages(
    agentKey: string,
    newMessages: Record<string, unknown>[],
  ): Promise<void> {
    const now = new Date();
    let latest = await this.findLatestSeg(agentKey);

    // 估算当前段已用字节数（JSON 序列化），决定是否需要开新段
    const latestBytes = latest
      ? Buffer.byteLength(JSON.stringify(latest.messages))
      : 0;

    if (!latest || latestBytes >= SEG_SOFT_LIMIT_BYTES) {
      const nextSeg = latest ? latest.segIndex + 1 : 0;
      this.logger.debug(
        `appendMessages: agentKey=${agentKey} 开新段 seg=${nextSeg}（上段 ${latestBytes}B）`,
      );
      latest = await this.sessionModel.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: nextSeg,
        messages: [],
        createdAt: now,
        lastActiveAt: now,
      });
    }

    await this.sessionModel.updateOne(
      { _id: latest._id },
      {
        $push: { messages: { $each: newMessages } },
        $set: { lastActiveAt: now },
      },
    );
  }

  /**
   * 跨段倒取最近 limit 条（返回正序：旧→新）。
   * 从最新段开始往前累积，够 limit 条即停，避免全段扫描。
   * 用于上下文窗口组装（只需最近 N 条）。
   */
  async getRecentMessages(
    agentKey: string,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    // 按 segIndex 倒序取段，从新到旧累积
    const segs = await this.sessionModel
      .find({ agentKey })
      .sort({ segIndex: -1 });
    const flat: Record<string, unknown>[] = [];
    for (const seg of segs) {
      // unshift 保持正序（旧→新），每次把更老的段消息插到头部
      flat.unshift(...seg.messages);
      if (flat.length >= limit) break;
    }
    // slice(-limit) 保留最新的 limit 条（正序）
    return flat.slice(-limit);
  }

  /**
   * 全部消息（跨段，正序）——聚合分页和 read_conversation_history 工具用。
   * 数据量可能很大，调用方应按需分页或配合 limit 使用。
   */
  async getAllMessages(agentKey: string): Promise<Record<string, unknown>[]> {
    const segs = await this.sessionModel
      .find({ agentKey })
      .sort({ segIndex: 1 });
    return segs.flatMap((s) => s.messages);
  }

  /**
   * 删除某 agentKey 的全部段。
   * 用于草稿删除或测试清理，不可恢复——messages append-only 原则不适用于整体删除。
   */
  async deleteByAgentKey(agentKey: string): Promise<void> {
    await this.sessionModel.deleteMany({ agentKey });
  }
}
