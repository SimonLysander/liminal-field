/**
 * DigestTask — 工作流任务状态持久化（graph state + 前端可查状态）。
 *
 * 生命周期：
 *   1. react_agent 节点启动前创建，status=running
 *   2. react_agent 执行过程中通过 save_finding 工具累积 findings
 *   3. react_agent 每一步（tool_call + result）通过 onStepFinish 钩子追加到 steps
 *   4. compose + commit 完成后回写 status=done + reportContentItemId + reportSummary
 *   5. 任意节点抛错写 status=failed + error
 *
 * findings 内 citationId 由 save_finding 工具全局递增分配，
 * compose 节点用 [CIT N] 引用，N = citationId。
 *
 * 业务 id 前缀 dt_，与 pfi_/ci_/stc_ 风格统一。
 *
 * 字段严格按 §3.2 文档。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

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

  /** RSS 摘要（去 HTML 纯文本，≤800 字）— compose 的背景素材，原文缺失时的兜底。
   *  可选:部分源(arxiv abstract 缺失 / 抓取无摘要)snippet 为空,允许空——fulltext 才是主素材。
   *  (注:之前 required,但 commit 改 create 后会跑 schema 校验,空 snippet 报错 → 此处放开) */
  @prop()
  snippet?: string;

  /** LLM 给的"为啥挑这条 / 关键判断" — 降为导读层「理由」属性，让 compose 注意力集中 + 过程透明 */
  @prop({ required: true })
  reason!: string;

  /**
   * web_fetch 抓到的原文正文 — compose 写报告的【一手素材】。
   * 由 react-agent 在 web_fetch 后按 url 自动留存(onStepFinish 拦截 detail),pick 时关联进来,
   * agent 无需把原文复制进 pick 参数(省 token、不丢字)。实测每篇 2-4k 字符,存 task 无压力
   * (1M context / 16MB 文档都绰绰有余)。可选:只看 snippet 就 pick、没 web_fetch 过的条目无此字段。
   */
  @prop()
  fulltext?: string;
}

/**
 * Agent 调用链中的一步（一个 tool_call + 其结果摘要）。
 *
 * 边跑边追加：react-agent.node 在 generateText 的 onStepFinish 钩子里调
 * taskRepository.appendStep 把每步写进 DigestTask.steps。
 *
 * 设计约束：只存"调用链回放"所需信息，不存抓取的全文内容（避免单条 task 文档膨胀到几 MB）。
 *   - args: 工具入参（query/url/sourceId/limit 这些短字段）
 *   - summary: 工具返回的 ToolResult.summary（人话一句）
 *   - meta: 数值类聚合（count/durationMs 等），不含 detail/markdown/content 等大字段
 */
export interface AgentStep {
  /** 触发时间 */
  ts: Date;
  /** browse / web_search / web_fetch / pick */
  toolName: string;
  /** 短入参（长字符串截断 200 字） */
  args: Record<string, unknown>;
  /** 工具返回的人话一句（ToolResult.summary） */
  summary: string;
  /** 数值类聚合（count/totalFetched 等） */
  meta?: Record<string, number | string>;
  /** 工具调用耗时（ms），当前 generateText.step 不直接给单工具时延，暂为 0） */
  durationMs: number;
  /** 工具调用失败时的错误码或消息（不含 stack） */
  error?: string;
}

@modelOptions({
  schemaOptions: { collection: 'digest_tasks' },
  // steps 是 AgentStep[]（interface，非 class），用 [Object] 存 Mixed 数组
  options: { allowMixed: Severity.ALLOW },
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

  /**
   * Agent 调用链步骤（tool_call + 结果摘要）。
   * 边跑边追加（$push 原子写），不存抓取全文，详见 AgentStep 注释。
   */
  @prop({ type: () => [Object], default: [] })
  steps!: AgentStep[];

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
