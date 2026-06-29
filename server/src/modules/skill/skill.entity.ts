/**
 * Skill — Agent 可调用的「方法论」实体。
 *
 * 全局池,管理员 CRUD;Agent 通过 AgentEntryConfig.enabledSkillIds 引用授权使用。
 * 运行时:
 *   - prompt.handler 把 name + description + whenToUse 注入 system prompt 的 <available_skills>
 *   - agent 调 Skill 工具(传 name)时,body 作为 tool_result 注入对话(永不进 system prompt)
 *
 * 参见 docs/superpowers/specs/2026-06-03-agent-skills-design.md §4.1
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

@modelOptions({
  schemaOptions: { collection: 'skills', timestamps: true },
  options: { allowMixed: Severity.ERROR },
})
export class Skill {
  readonly _id!: Types.ObjectId;

  /** slug,唯一,用于 slash 命令(/critic)。匹配 /^[a-z][a-z0-9_-]{1,40}$/。 */
  @prop({ required: true, trim: true, unique: true, index: true })
  public name!: string;

  /** 中文展示名(批评家、润色师等),给管理端 UI 列表显示 */
  @prop({ required: true, trim: true })
  public displayName!: string;

  /** ≤80 字,一句话描述 — 进 <available_skills> 给 agent 看 */
  @prop({ required: true, trim: true, maxlength: 80 })
  public description!: string;

  /** ≤200 字,什么场景该用 — 进 <available_skills> 引导 agent 自动判断 */
  @prop({ required: true, trim: true, maxlength: 200 })
  public whenToUse!: string;

  /** markdown 正文,invoke 时作为 tool_result 注入;永不进 system prompt */
  @prop({ required: true })
  public body!: string;

  /** 该 skill 必须的工具名(全局工具名);授权 agent 启用时校验 subset of agent.tools */
  @prop({ type: () => [String], default: [] })
  public requiredTools!: string[];

  /**
   * 是否内置 skill(定义在 prompts/builtin-skills.ts + skills/*.md,body 以文件为准、UI 只读)。
   * 解析时合成标记,不为用户新建 skill 持久化;供前端区分"内置只读 / 用户可编"。
   */
  @prop({ default: false })
  public builtin?: boolean;

  public createdAt!: Date;
  public updatedAt!: Date;
}
