import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * AgentMemory 类型：
 * - user：以所有者为中心——背景、偏好、风格、习惯（始终全文注入 system prompt）
 * - project：以事情为中心——某篇文章的进展、决策、上下文（只注入标题，按需读取）
 */
export type AgentMemoryType = 'user' | 'project';

/**
 * AgentMemory — lux-stirring 的持久记忆。
 *
 * title 是唯一标识——由 Memory Agent（LLM）决定命名和去重。
 * 所有记忆写入通过 MemoryAgentService，不直接操作数据库。
 */
@modelOptions({
  schemaOptions: {
    collection: 'agent_lux_memories',
    timestamps: false,
  },
  options: { allowMixed: Severity.ERROR },
})
export class AgentMemory {
  @prop()
  _id!: Types.ObjectId;

  /** 记忆类型：user（始终全文注入）/ project（只注入标题） */
  @prop({ required: true, type: () => String, enum: ['user', 'project'] })
  type!: AgentMemoryType;

  /** 一行摘要 + 唯一标识（≤100 字），Memory Agent 命名，upsert by title */
  @prop({ required: true, unique: true, trim: true, maxlength: 100 })
  title!: string;

  /** 完整内容，markdown 格式（≤2000 字） */
  @prop({ required: true, trim: true, maxlength: 2000 })
  content!: string;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;
}
