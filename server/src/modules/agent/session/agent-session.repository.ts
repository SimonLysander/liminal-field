import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { getModelToken } from 'nestjs-typegoose';
import { AgentSession } from './agent-session.entity';
import { estimateTokens } from '../context/token-estimate';

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
export class AgentSessionRepository implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentSessionRepository.name);

  constructor(
    @Inject(getModelToken(AgentSession.name))
    private readonly sessionModel: ReturnModelType<typeof AgentSession>,
  ) {}

  /**
   * 启动时自动清理 V6 重构遗留的 `sessionKey_1` 唯一索引。
   *
   * 历史:V6 重构(2026-05)把 entity 的 sessionKey 字段移除,改用 agentKey+segIndex,
   * 但 MongoDB collection 上的 `sessionKey_1` (unique) 索引没跟着 drop。新文档没有
   * sessionKey 字段 → MongoDB 存为 null → 第二个文档撞 unique null → E11000 写入失败,
   * 整个对话历史 append 链路爆 500,用户刷新丢上下文。
   *
   * 已存在则 drop;已删过则忽略 IndexNotFound(下次启动不会再尝试)。
   * 一次性自愈,不写迁移脚本(那需要单独跑)。
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const indexes: Array<{ name?: string }> = (await this.sessionModel.collection
        .indexes()
        .catch(() => [])) as Array<{ name?: string }>;
      const hasLegacy = indexes.some((idx) => idx.name === 'sessionKey_1');
      if (!hasLegacy) return;
      await this.sessionModel.collection.dropIndex('sessionKey_1');
      this.logger.log('已清理 V6 遗留索引 sessionKey_1');
    } catch (err) {
      // IndexNotFound 等不致命,只 warn 不阻断启动
      this.logger.warn(
        `清理 sessionKey_1 索引失败(可能已不存在):${(err as Error)?.message ?? err}`,
      );
    }
  }

  // ─── 分段读写（agentKey + segIndex，唯一存储路径） ──────────────────────────

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
   * 跨段倒取「最近一段、token 不超 window*ratio」的消息(返回正序:旧→新)。
   * 与 getRecentMessages 区别:按 token 预算而非条数裁剪,口径对齐 splitForCompaction
   * (ratio 传 TRIGGER_RATIO=0.6),保证读取量 ≥ 后续喂模型量,更早的靠记忆摘要兜。
   * 从最新段往前累积,累计 token 超预算即停;保底至少返回最近 1 条。
   */
  async getRecentByBudget(
    agentKey: string,
    window: number,
    ratio: number,
  ): Promise<Record<string, unknown>[]> {
    const budget = window * ratio;
    const segs = await this.sessionModel
      .find({ agentKey })
      .sort({ segIndex: -1 });
    const flat: Record<string, unknown>[] = [];
    let acc = 0;
    // 段倒序(新→旧),段内也倒序累加,才能"从最新一条往前数";保底至少 1 条
    for (const seg of segs) {
      for (let i = seg.messages.length - 1; i >= 0; i--) {
        const m = seg.messages[i];
        const t = estimateTokens(m);
        if (acc + t > budget && flat.length >= 1) {
          return flat; // 已正序(每次 unshift 到头部)
        }
        flat.unshift(m);
        acc += t;
      }
    }
    return flat;
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

  async listBusinessSessions(agentInstanceKey: string): Promise<
    Array<{
      sessionKey: string;
      title: string;
      messageCount: number;
      lastActiveAt: Date | null;
    }>
  > {
    const prefix = `${agentInstanceKey}:chat:`;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const segs = await this.sessionModel
      .find({
        $or: [
          { agentKey: agentInstanceKey },
          { agentKey: { $regex: `^${escapedPrefix}` } },
        ],
      })
      .sort({ agentKey: 1, segIndex: 1 });

    const byKey = new Map<
      string,
      {
        sessionKey: string;
        title: string;
        messageCount: number;
        lastActiveAt: Date | null;
      }
    >();

    for (const seg of segs) {
      const current =
        byKey.get(seg.agentKey) ??
        {
          sessionKey: seg.agentKey,
          title: '',
          messageCount: 0,
          lastActiveAt: null,
        };
      current.messageCount += seg.messages.length;
      current.lastActiveAt =
        !current.lastActiveAt || seg.lastActiveAt > current.lastActiveAt
          ? seg.lastActiveAt
          : current.lastActiveAt;
      if (!current.title) {
        current.title = seg.title?.trim() || inferSessionTitle(seg.messages);
      }
      byKey.set(seg.agentKey, current);
    }

    return Array.from(byKey.values())
      .map((session) => ({
        ...session,
        title: session.title || '新会话',
      }))
      .sort(
        (a, b) =>
          (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0),
      );
  }

  async renameBusinessSession(sessionKey: string, title: string): Promise<void> {
    const cleanTitle = title.trim().slice(0, 80);
    const now = new Date();
    const result = await this.sessionModel.updateMany(
      { agentKey: sessionKey },
      { $set: { title: cleanTitle, lastActiveAt: now } },
    );
    if (result.matchedCount > 0) return;

    await this.sessionModel.create({
      _id: new Types.ObjectId(),
      agentKey: sessionKey,
      title: cleanTitle,
      segIndex: 0,
      messages: [],
      createdAt: now,
      lastActiveAt: now,
    });
  }

  /**
   * 删除某 agentKey 的全部段。
   * 用于草稿删除或测试清理，不可恢复——messages append-only 原则不适用于整体删除。
   */
  async deleteByAgentKey(agentKey: string): Promise<void> {
    await this.sessionModel.deleteMany({ agentKey });
  }
}

function inferSessionTitle(messages: Record<string, unknown>[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const parts = message.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .filter((part): part is { type: string; text?: string } => {
        return (
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'text'
        );
      })
      .map((part) => part.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}...` : text;
  }
  return '';
}
