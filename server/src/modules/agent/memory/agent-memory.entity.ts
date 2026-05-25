import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * AgentMemory 类型：
 * - user：以所有者为中心——背景、偏好、风格、习惯（始终全文注入 system prompt）
 * - session：草稿级会话记忆——某草稿 agentKey 对应的写作上下文与计划（一草稿一条）
 */
export type AgentMemoryType = 'user' | 'session';

/**
 * AgentMemory — lux-stirring 的持久记忆。
 *
 * title 是唯一标识——由 Memory Agent（LLM）决定命名和去重。
 * session 类型的 title 固定为 `session:${agentKey}`，唯一性靠 agentKey partial index 保证。
 * 所有记忆写入通过 MemoryAgentService，不直接操作数据库。
 *
 * 索引说明：
 * - title unique index（全局）：user 记忆由 LLM 命名去重
 * - agentKey partial unique index（仅 session 类型）：保证一草稿一条会话记忆
 */
@index(
  { agentKey: 1 },
  { unique: true, partialFilterExpression: { type: 'session' } },
)
@modelOptions({
  schemaOptions: {
    collection: 'agent_lux_memories',
    timestamps: false,
  },
  // tasks 字段存动态结构对象数组（Record<string, unknown>[]），需要 ALLOW Mixed
  options: { allowMixed: Severity.ALLOW },
})
export class AgentMemory {
  @prop()
  _id!: Types.ObjectId;

  /** 记忆类型：user（始终全文注入）/ session（草稿级会话） */
  @prop({
    required: true,
    type: () => String,
    enum: ['user', 'session'],
  })
  type!: AgentMemoryType;

  /** 一行摘要 + 唯一标识（≤100 字），Memory Agent 命名，upsert by title */
  @prop({ required: true, unique: true, trim: true, maxlength: 100 })
  title!: string;

  /** 完整内容，markdown 格式（≤2000 字） */
  @prop({ required: true, trim: true, maxlength: 2000 })
  content!: string;

  /**
   * session 类型专用：所属草稿的 agentKey（即草稿 ID）。
   * user 类型为 null。
   * partial unique index 保证同一 agentKey 只存一条 session 记忆。
   */
  @prop({ type: () => String, default: null })
  agentKey!: string | null;

  /**
   * session 类型专用：草稿级写作计划（Agent 工作状态）。
   * 结构由上层 service 定义，entity 层只保证存取，不校验内部字段。
   */
  @prop({ type: () => [Object], default: [] })
  tasks!: Array<Record<string, unknown>>;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;
}
