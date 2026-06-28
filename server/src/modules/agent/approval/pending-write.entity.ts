import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';

/**
 * PendingWrite — HITL 工具门禁的「待审批写入」暂存记录。
 *
 * 设计:被门禁的写工具(write_draft/write_learn_plan/write_tasks/remember)在 execute 里
 * 不直接落库,而是把「真正写所需的一切」(toolName + 目标 + 原始入参)暂存为本记录,
 * 返回 pending_approval。用户在会话里点「允许」→ approve 端点据本记录复算并真正落库;
 * 「拒绝」→ 丢弃。这样审批是带外 REST 动作,不动 streamText 单向流。
 *
 * _id = AI SDK toolCallId(一次工具调用全局唯一),审批端点按它精确定位。
 * TTL:createdAt 24h 后自动过期清理,避免没裁决的暂存常驻。
 */
export type PendingWriteStatus = 'pending' | 'approved' | 'rejected';

@index({ sessionKey: 1, status: 1 })
@index({ createdAt: 1 }, { expireAfterSeconds: 86400 })
@modelOptions({
  schemaOptions: { collection: 'agent_pending_writes', timestamps: false },
  // payload / preview 是随工具而变的动态结构,需要 ALLOW Mixed
  options: { allowMixed: Severity.ALLOW },
})
export class PendingWrite {
  /** AI SDK toolCallId(主键) */
  @prop({ required: true, type: () => String })
  _id!: string;

  /** 所属会话,审批鉴权 + 回灌定位用 */
  @prop({ required: true, type: () => String })
  sessionKey!: string;

  /** 被门禁的写工具名 */
  @prop({ required: true, type: () => String })
  toolName!: string;

  /** 写 aidraft 类的目标节点(工厂绑定);tasks/remember 无,为 null */
  @prop({ type: () => String, default: null })
  targetContentItemId!: string | null;

  /** tasks/remember 写 agent 记忆时按 agentKey 定位;无则 null */
  @prop({ type: () => String, default: null })
  agentKey!: string | null;

  /** 工具原始入参(动态结构),commit 时据此复算真正的写 */
  @prop({ type: () => Object, required: true })
  payload!: Record<string, unknown>;

  /** 给前端审批卡的轻量预览(如 {title, charCount, summary}) */
  @prop({ type: () => Object, default: {} })
  preview!: Record<string, unknown>;

  @prop({
    required: true,
    type: () => String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  status!: PendingWriteStatus;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ type: () => Date, default: null })
  resolvedAt!: Date | null;

  /** 裁决结果(approve/reject)是否已在后续 chat 回灌给模型——只回灌一次,避免每轮重复注入 */
  @prop({ required: true, type: () => Boolean, default: false })
  notifiedToModel!: boolean;
}
