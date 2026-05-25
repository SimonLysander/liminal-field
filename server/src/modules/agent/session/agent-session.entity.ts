import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * AgentSession — 业务对话原文,分段存储(新架构唯一路径)。
 *
 * 设计核心(见 specs/2026-05-25-agent-context-memory-design.md):
 * - 业务对话原文 append-only,永不删——既给人翻看,也供 agent 精确回溯。
 * - 一个 agentKey(= 草稿,如 `draft-${id}`)对应 N 段;单段接近 16MB 硬上限时
 *   自动开下一段(segIndex+1),前端按 agentKey 跨段聚合,用户无感。
 * - summary / tasks / 轮数等旧概念已迁出:对话脉络归 session 记忆(agent_lux_memories),
 *   写作计划归 session 记忆的 tasks 字段,本实体只存对话原文。
 */
@index({ agentKey: 1, segIndex: 1 }, { unique: true })
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
   * agent 实例标识(= 草稿,如 `draft-${id}`)。
   * 一个 agentKey 对应多段文档,是跨段聚合的核心键。
   */
  @prop({ required: true, trim: true })
  agentKey!: string;

  /**
   * 段序号:同 agentKey 内从 0 递增。
   * 接近 16MB 硬上限时(软上限 14MB)自动开下一段,用户无感。
   * messages append-only:永不删,只追加或开新段。
   */
  @prop({ required: true, default: 0 })
  segIndex!: number;

  /**
   * 这一段的对话原文(UIMessage[]),mixed 类型直接存 JSON。
   * 只 $push 追加,永不 $set 全量覆盖。
   */
  @prop({ required: true, type: () => [Object], default: [] })
  messages!: Record<string, unknown>[];

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  /** 最后一次活跃时间,用于后续清理过期会话 */
  @prop({ required: true, type: () => Date })
  lastActiveAt!: Date;
}
