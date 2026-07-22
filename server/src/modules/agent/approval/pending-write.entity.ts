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
 * TTL:仅未裁决记录通过 expiresAt 在 24h 后清理；终态作为跨设备审批凭据长期保留。
 */
export const PENDING_WRITE_TTL_MS = 24 * 60 * 60 * 1000;

export type PendingWriteStatus =
  | 'pending'
  | 'committing'
  | 'approved'
  | 'rejected'
  | 'superseded';
export type PendingWriteDisplayStatus = Exclude<
  PendingWriteStatus,
  'committing'
>;
export type PendingWriteApproval =
  | { status: 'pending' | 'expired'; resolvedAt: null }
  | {
      status: Exclude<PendingWriteDisplayStatus, 'pending'>;
      /** 该审批记录进入终态并成功落库的服务端时间。 */
      resolvedAt: Date;
    };

/** 将 Mongo 状态机映射为前端展示契约，并拒绝缺少裁决时间的损坏终态。 */
export function toPendingWriteApproval(
  write: Pick<PendingWrite, 'status' | 'expiresAt' | 'resolvedAt'>,
  now: Date,
): PendingWriteApproval {
  if (write.status === 'pending' || write.status === 'committing') {
    const expired =
      write.expiresAt instanceof Date &&
      write.expiresAt.getTime() <= now.getTime();
    return { status: expired ? 'expired' : 'pending', resolvedAt: null };
  }
  if (!(write.resolvedAt instanceof Date)) {
    throw new Error(`审批终态缺少 resolvedAt status=${write.status}`);
  }
  return { status: write.status, resolvedAt: write.resolvedAt };
}

@index({ sessionKey: 1, status: 1 })
@index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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

  /** 工具原始入参；仅 pending/committing 保留，进入终态后删除。 */
  @prop({ type: () => Object })
  payload?: Record<string, unknown>;

  /** 给前端审批卡的轻量预览；进入终态后删除。 */
  @prop({ type: () => Object })
  preview?: Record<string, unknown>;

  @prop({
    required: true,
    type: () => String,
    enum: ['pending', 'committing', 'approved', 'rejected', 'superseded'],
    default: 'pending',
  })
  status!: PendingWriteStatus;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  /** 未裁决记录的绝对失效时间；进入终态时删除该字段，避免 TTL 删除审批结论。 */
  @prop({ type: () => Date })
  expiresAt?: Date;

  @prop({ type: () => Date, default: null })
  resolvedAt!: Date | null;

  /** 批准提交的租约起点；进程中断后，过期 committing 可被下一次审批安全接管。 */
  @prop({ type: () => Date, default: null })
  commitStartedAt!: Date | null;

  /** 当前提交租约的 fencing token，阻止旧执行者完成或回滚新租约。 */
  @prop({ type: () => String, default: null })
  commitToken!: string | null;

  /** 每次成功 claim 单调递增，作为目标存储条件写的 fencing version。 */
  @prop({ required: true, type: () => Number, default: 0 })
  commitVersion!: number;

  /** 暂存时由目标计数器分配；不同审批卡共享同一严格单调顺序。 */
  @prop({ required: true, type: () => Number, default: 0 })
  fenceSequence!: number;

  /** 裁决结果(approve/reject)是否已在后续 chat 回灌给模型——只回灌一次,避免每轮重复注入 */
  @prop({ required: true, type: () => Boolean, default: false })
  notifiedToModel!: boolean;
}
