/**
 * DigestTask — 工作流任务状态持久化（graph state + 前端可查状态）。
 *
 * 生命周期：
 *   1. react_agent 节点启动前创建，status=running
 *   2. react_agent 执行过程中通过 save_finding 工具累积 findings
 *   3. compose + commit 完成后回写 status=done + reportContentItemId + reportSummary
 *   4. 任意节点抛错写 status=failed + error
 *
 * findings 内 citationId 由 save_finding 工具全局递增分配，
 * compose 节点用 [CIT N] 引用，N = citationId。
 *
 * 业务 id 前缀 dt_，与 pfi_/ci_/stc_ 风格统一。
 *
 * 字段严格按 §3.2 文档。
 */
import { modelOptions, prop } from '@typegoose/typegoose';

export enum DigestTaskStatus {
  running = 'running',
  done = 'done',
  failed = 'failed',
}

/** react_agent 阶段通过 save_finding 工具累积的命中条目 */
export class Finding {
  /** [CIT N] 里的 N，全局递增（save_finding 工具分配） */
  @prop({ required: true })
  citationId!: number;

  @prop({ required: true })
  sourceId!: string;

  @prop({ required: true })
  sourceName!: string;

  @prop({ required: true })
  itemGuid!: string;

  @prop({ required: true })
  title!: string;

  @prop({ required: true })
  url!: string;

  /** 发布时间，RSS publishedAt；无则不填 */
  @prop({ type: () => Date })
  publishedAt?: Date;

  /** RSS 摘要 / 用户保留的全文片段，供 compose 节点引用 */
  @prop({ required: true })
  snippet!: string;

  /** LLM 给的"为啥挑这条"，可观测性 */
  @prop({ required: true })
  reason!: string;
}

@modelOptions({
  schemaOptions: { collection: 'digest_tasks' },
})
export class DigestTask {
  /** dt_xxx 业务 id */
  @prop({ required: true })
  _id!: string;

  /** 事项 ContentItem.id（ci_xxx） */
  @prop({ required: true, index: true })
  topicId!: string;

  @prop({ enum: DigestTaskStatus, required: true })
  status!: DigestTaskStatus;

  /** react_agent 通过 save_finding 累积的命中条目 */
  @prop({ type: () => [Finding], default: [] })
  findings!: Finding[];

  /** commit 后回写的报告 ContentItem.id */
  @prop()
  reportContentItemId?: string;

  /** 报告 markdown 前 N 字，前端列表预览用 */
  @prop()
  reportSummary?: string;

  /** failed 时的错误描述 */
  @prop()
  error?: string;

  /** 全链路追踪 id，贯穿 react_agent / compose / commit 三节点 */
  @prop({ required: true })
  traceId!: string;

  /** react_agent 跑了几轮（stepCount），可观测性 */
  @prop({ required: true, default: 0 })
  iterations!: number;

  /** 累计 LLM 调用次数（react_agent steps + compose 1 次），可观测性 */
  @prop({ required: true, default: 0 })
  llmCallsCount!: number;

  @prop({ required: true, type: () => Date })
  startedAt!: Date;

  @prop({ type: () => Date })
  completedAt?: Date;
}
