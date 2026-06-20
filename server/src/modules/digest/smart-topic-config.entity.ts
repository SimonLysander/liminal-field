/**
 * SmartTopicConfig — 智能采集事项配置（智能小应用·自动信息收集）。
 *
 * 跟「事项」（digest scope 的根 NavigationNode 容器）一对一绑定，
 * 通过 contentItemId 关联（事项容器的 ContentItem.id，ci_xxx）。
 *
 * 拆出来不放进 ContentItem 是因为：这是「工作流调度元数据」，跟"内容"语义无关；
 * 放在独立 collection 易于后续按 enabled / cron 索引、扫描调度。
 *
 * 业务 id 用 stc_xxx。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

export enum RunStatus {
  ok = 'ok',
  failed = 'failed',
  running = 'running',
}

/**
 * 用户自定义内容指标 — 每个事项可以配关心的结构化字段。
 * AI Judge 调用时把 schema 拼进 prompt，让 LLM 从原文提取这些字段。
 * 详见 docs/digest-workflow-design.md §3
 */
export interface ExtractField {
  /** 字段 key，如 'venue'；用作 markdown frontmatter 字段名 */
  key: string;
  /** 显示名，如 '举办地点' */
  label: string;
  type: 'string' | 'date' | 'number' | 'enum' | 'list';
  /** 给 AI 的提示，描述字段含义和提取策略 */
  description: string;
  /** type=enum 时的可选值 */
  enum?: string[];
  /** false 时 AI 可以返回 null（找不到就找不到，不强行编） */
  required?: boolean;
  extractionMode: 'ai' | 'regex';
  /** extractionMode=regex 时的正则表达式 */
  regex?: string;
}

@modelOptions({
  schemaOptions: { collection: 'smart_topic_configs' },
  // extractFields 是 Mixed 数组，需要 ALLOW（其余字段保持强类型）
  options: { allowMixed: Severity.ALLOW },
})
export class SmartTopicConfig {
  @prop({ required: true, trim: true })
  _id!: string;

  /** 绑定的事项容器 ContentItem.id（ci_xxx）。unique 保证一对一。 */
  @prop({ required: true, trim: true, unique: true })
  contentItemId!: string;

  /** cron 表达式 — 五段式（minute hour day-of-month month day-of-week），如 '0 8 * * *' 每天早 8 点。
   *  @nestjs/schedule 的 CronExpression 支持五段式与七段式。 */
  @prop({ required: true, trim: true })
  cron!: string;

  /** 订阅的 InfoSource._id 列表（src_xxx）。运行时 join 解引用。 */
  @prop({ type: () => [String], required: true, default: [] })
  sourceIds!: string[];

  /** 关键词预筛：命中其中之一才进入 LLM 二次判定。空数组 = 不预筛，全送 LLM（贵）。 */
  @prop({ type: () => [String], required: true, default: [] })
  keywords!: string[];

  /** AI 判定"相关性"的 prompt — 描述事项关心什么、什么算相关。 */
  @prop({ required: true, trim: true })
  prompt!: string;

  @prop({ required: true, default: true })
  enabled!: boolean;

  /**
   * 用户自定义内容指标 — 每个事项可以配关心的结构化字段。
   * AI Judge 调用时把 schema 拼进 prompt，让 LLM 从原文提取这些字段。
   * type=Mixed（Object 数组）因为 typegoose 不能直接序列化复杂 interface；
   * 运行时 schema 完全 OK，老数据 forwards-compatible（缺字段 mongoose 补 default []）。
   */
  @prop({ type: () => [Object], required: true, default: [] })
  extractFields!: ExtractField[];

  /**
   * 每期取相关条目里的 Top N（按 quality × importance 排序）。
   * 默认 10，范围 1-100 由 DTO 层校验。
   */
  @prop({ required: true, default: 10 })
  topN!: number;

  @prop({ type: () => Date })
  lastRunAt?: Date;

  @prop({ enum: RunStatus })
  lastRunStatus?: RunStatus;

  @prop({ trim: true })
  lastRunError?: string;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ type: () => Date })
  updatedAt?: Date;
}
