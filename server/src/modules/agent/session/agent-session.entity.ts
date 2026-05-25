import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * AgentSession — 持久化一次 agent 会话。
 *
 * sessionKey 是不透明字符串，由调用方决定语义（可以是文档 ID、页面路由、
 * 或任意自定义标识）。记忆系统不关心它代表什么业务实体。
 *
 * messages 存储最近 N 轮完整消息（UIMessage[]），超出部分被压缩为 summary。
 * 恢复时前端同时拿到 summary + messages，组装完整上下文。
 */
@modelOptions({
  schemaOptions: {
    collection: 'agent_sessions',
    timestamps: false,
  },
  options: { allowMixed: Severity.ALLOW },
})
export class AgentSession {
  @prop()
  _id!: Types.ObjectId;

  /**
   * 会话标识，唯一索引。旧架构字段，渐进期保留。
   * 新段文档（agentKey 路径）不写此字段，故 required 改为 false。
   * 清理单元（U6）再删此字段及 unique 索引。
   */
  @prop({ required: false, unique: true, sparse: true, trim: true })
  sessionKey?: string;

  /**
   * 最近 N 轮的 UIMessage[]，mixed 类型直接存 JSON。
   * compaction 后只保留最近 N=8 轮，更早的消息压缩进 summary。
   */
  @prop({ required: true, type: () => [Object] })
  messages!: Record<string, unknown>[];

  /** 被压缩掉的旧消息的摘要。首次对话或未触发过压缩时为空。 */
  @prop({ type: () => String, default: '' })
  summary!: string;

  /** 历史总轮数（含已压缩的），用于判断是否触发 compaction。一轮 = 一对 user+assistant。 */
  @prop({ type: () => Number, default: 0 })
  totalRounds!: number;

  /**
   * 写作任务列表。agent 通过工具创建/更新，前端渲染 checkbox。
   * 跟 session 走——session 清掉，tasks 跟着没了。
   */
  @prop({ type: () => [Object], default: [] })
  tasks!: Array<{
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'done';
    blocks: string[]; // 我挡着谁（ID 列表）
    blockedBy: string[]; // 我被谁挡着（ID 列表）
    metadata: Record<string, unknown>;
    createdAt: string;
    completedAt: string | null;
  }>;

  /**
   * agent 实例标识（= 草稿，如 `draft-${id}`）。
   * 一个 agentKey 对应多段文档，是跨段聚合的核心键。
   * 渐进期与旧 sessionKey 并存，不设 unique 复合索引——
   * 旧数据 agentKey=null 会导致唯一冲突，等清理单元（U6）移除旧字段后再加。
   */
  @prop({ default: null })
  agentKey!: string | null;

  /**
   * 段序号：同 agentKey 内从 0 递增。
   * 接近 16MB 硬上限时（软上限 14MB）自动开下一段，用户无感。
   * messages append-only：永不删，只追加或开新段。
   */
  @prop({ default: 0 })
  segIndex!: number;

  /** 最后一次活跃时间，用于后续清理过期会话 */
  @prop({ required: true, type: () => Date })
  lastActiveAt!: Date;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;
}
