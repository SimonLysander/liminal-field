/**
 * AgentMemoryObservation — Aurora 对所有者的一次观察(2026-05-30 起,#150 续 event log 架构)。
 *
 * 设计宪法:**append-only 岁月史书**。永远不 update,永远不 delete。
 * 24 岁的观察、26 岁的观察、27 岁的观察都各自存一条,LLM 派生 current_view 时
 * 从全量 observations 推导"当前画像 + 轨迹",而不是覆盖。
 *
 * 触发:每轮对话后 `MemoryObserverService.observe()` 由后台 LLM 决策 append 0~N 条。
 * 主 agent 完全无感(没有 remember/forget 工具调用塑形过程)。
 */
import { index, modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * 硬枚举 4 类 + 兜底 other。
 * 详细语义见 docs/superpowers/specs/2026-05-30-memory-event-log-design.md §三 Topic 字典。
 *
 * 简记:
 * - identity — 是谁(客观属性 / 出厂底色)
 * - personality — 怎么感受 / 内在质地
 * - aesthetic — 觉得什么是好 / 美 / 对(跨场景判断)
 * - method — 怎么做事 / 思维模型(跨学科操作系统)
 * - other — 兜底,不要轻易用
 */
export type ObservationTopic =
  | 'identity'
  | 'personality'
  | 'aesthetic'
  | 'method'
  | 'other';

export const OBSERVATION_TOPICS: ObservationTopic[] = [
  'identity',
  'personality',
  'aesthetic',
  'method',
  'other',
];

// observedAt 倒序索引(派生 current_view + UI 时间序列展示主路径)
@index({ observedAt: -1 })
// topic + observedAt 复合索引(按 topic 筛选 + 时间排序的常见组合)
@index({ topic: 1, observedAt: -1 })
@modelOptions({
  schemaOptions: {
    collection: 'agent_memory_observations',
    timestamps: false,
  },
})
export class AgentMemoryObservation {
  @prop()
  _id!: Types.ObjectId;

  /** 观察发生的时刻(append 时塞 new Date()) */
  @prop({ required: true, type: () => Date })
  observedAt!: Date;

  /** 4 类 topic + other 兜底 */
  @prop({
    required: true,
    type: () => String,
    enum: OBSERVATION_TOPICS,
  })
  topic!: ObservationTopic;

  /** 本次观察的实质(自然语言一句话/一段话,LLM 写) */
  @prop({ required: true, trim: true, maxlength: 500 })
  observation!: string;

  /**
   * 当时聊到什么时观察到的(可空)。
   * 让"投入"信息天然沉淀:`聊到学微分方程时` / `改散文草稿时`——
   * Aurora 派生 current_view 时从所有 observations 的 context 自然归纳出"最近在做什么"。
   */
  @prop({ trim: true, maxlength: 300 })
  context?: string;

  /** 触发观察的 chat session(可空,用于审计/溯源) */
  @prop({ trim: true, maxlength: 200 })
  sessionKey?: string;
}

/**
 * AgentMemoryCurrentView — observer 派生出的当前画像 markdown(singleton)。
 *
 * observer 每跑完一次有新 observations,就顺带让 LLM 重派生一次 view markdown,
 * upsert 到这条单例。prompt.handler 直接读这条注入 <memories_index>,避免每轮 chat
 * 都跑 LLM 派生(每轮一次成本太高)。
 */
@modelOptions({
  schemaOptions: {
    collection: 'agent_memory_current_view',
    timestamps: false,
  },
})
export class AgentMemoryCurrentView {
  /** singleton:固定 _id,全局唯一 */
  @prop({ required: true, type: () => String })
  _id!: string;

  /** 派生的当前画像,markdown 格式,按 topic 分段 */
  @prop({ required: true, trim: true, maxlength: 8000 })
  markdown!: string;

  /** 派生时刻 */
  @prop({ required: true, type: () => Date })
  derivedAt!: Date;

  /**
   * 派生时的 observations 总数。
   * 用作脏检测——后续如果 observations 增长很多而 view 没更新,可触发重派生。
   */
  @prop({ required: true, type: () => Number, default: 0 })
  observationCount!: number;
}

export const CURRENT_VIEW_SINGLETON_ID = 'singleton';
