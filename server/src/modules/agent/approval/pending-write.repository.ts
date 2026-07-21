import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { isMongoDuplicateKeyError } from '../../../common/mongo-errors';
import { WriteFenceCounterRepository } from '../../workspace/write-fence-counter.repository';
import {
  PendingWrite,
  PENDING_WRITE_TTL_MS,
  type PendingWriteApiStatus,
} from './pending-write.entity';

export interface StashPendingWriteInput {
  toolCallId: string;
  sessionKey: string;
  toolName: string;
  targetContentItemId?: string | null;
  agentKey?: string | null;
  payload: Record<string, unknown>;
  preview?: Record<string, unknown>;
  now: Date;
}

export interface ApprovalClaim {
  commitVersion: number;
  fenceSequence: number;
}

function fenceTargetKey(write: {
  toolName: string;
  targetContentItemId?: string | null;
  agentKey?: string | null;
}): string | null {
  if (write.targetContentItemId) return `draft:${write.targetContentItemId}`;
  if (write.toolName === 'write_tasks' && write.agentKey) {
    return `tasks:${write.agentKey}`;
  }
  return null;
}

/**
 * PendingWriteRepository — 待审批写入的存取。
 * upsert by _id(toolCallId);审批端点按 _id 取出复算;裁决后标 status + resolvedAt。
 */
@Injectable()
export class PendingWriteRepository {
  constructor(
    @Inject(getModelToken(PendingWrite.name))
    private readonly model: ReturnModelType<typeof PendingWrite>,
    private readonly writeFenceCounterRepo: WriteFenceCounterRepository,
  ) {}

  async stash(input: StashPendingWriteInput): Promise<void> {
    const existing = await this.model.exists({ _id: input.toolCallId });
    if (existing) return;
    const targetKey = fenceTargetKey(input);
    const fenceSequence = targetKey
      ? await this.writeFenceCounterRepo.next(targetKey)
      : 0;
    try {
      await this.model.findByIdAndUpdate(
        input.toolCallId,
        {
          // toolCallId 是幂等键；流式恢复或请求重放不得重置已裁决状态或现有租约。
          $setOnInsert: {
            sessionKey: input.sessionKey,
            toolName: input.toolName,
            targetContentItemId: input.targetContentItemId ?? null,
            agentKey: input.agentKey ?? null,
            payload: input.payload,
            preview: input.preview ?? {},
            status: 'pending',
            createdAt: input.now,
            expiresAt: new Date(input.now.getTime() + PENDING_WRITE_TTL_MS),
            resolvedAt: null,
            commitStartedAt: null,
            commitToken: null,
            commitVersion: 0,
            fenceSequence,
            notifiedToModel: false,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) throw error;
      // 同一 _id 的并发首次 upsert：另一执行者已完成暂存，按幂等成功处理。
      const existing = await this.model.exists({ _id: input.toolCallId });
      if (!existing) throw error;
    }
  }

  async findById(toolCallId: string): Promise<PendingWrite | null> {
    return this.model.findById(toolCallId);
  }

  /**
   * 会话加载时批量取审批状态，避免历史消息中的每张卡各发一次请求。
   * 未在期限内裁决、已被 TTL 清理的记录不在这里伪造状态，由生命周期层结合消息历史标为 expired。
   */
  async findStatusesBySessionKey(
    sessionKey: string,
    toolCallIds: string[],
    now = new Date(),
  ): Promise<Record<string, PendingWriteApiStatus>> {
    if (toolCallIds.length === 0) return {};
    const writes = await this.model
      .find(
        { sessionKey, _id: { $in: toolCallIds } },
        { _id: 1, status: 1, expiresAt: 1 },
      )
      .lean();
    return Object.fromEntries(
      writes.map((write) => {
        const unresolved =
          write.status === 'pending' || write.status === 'committing';
        const expired =
          unresolved &&
          write.expiresAt instanceof Date &&
          write.expiresAt.getTime() <= now.getTime();
        const status: PendingWriteApiStatus = expired
          ? 'expired'
          : write.status === 'committing'
            ? 'pending'
            : write.status;
        return [write._id, status];
      }),
    );
  }

  /** 原子占有批准提交权，防止重复审批并发执行副作用。 */
  async claimApproval(
    toolCallId: string,
    commitToken: string,
    now: Date,
  ): Promise<ApprovalClaim | null> {
    const write = await this.model.findOneAndUpdate(
      { _id: toolCallId, status: 'pending', expiresAt: { $gt: now } },
      {
        $set: {
          status: 'committing',
          commitStartedAt: now,
          commitToken,
          // 用户在有效期末点击允许时，提交不能在执行途中被 TTL 删除。
          expiresAt: new Date(now.getTime() + PENDING_WRITE_TTL_MS),
        },
        $inc: { commitVersion: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!write) return null;
    let fenceSequence = write.fenceSequence ?? 0;
    const targetKey = fenceTargetKey(write);
    if (fenceSequence <= 0 && targetKey) {
      // 兼容升级前已暂存、尚未过 TTL 的审批记录：取得租约后补分配目标序号。
      fenceSequence = await this.writeFenceCounterRepo.next(targetKey);
      const assigned = await this.model.updateOne(
        { _id: toolCallId, status: 'committing', commitToken },
        { $set: { fenceSequence } },
      );
      if (assigned.modifiedCount !== 1) return null;
    }
    return {
      commitVersion: write.commitVersion,
      fenceSequence,
    };
  }

  /** 副作用成功后才将记录裁决为 approved。 */
  async completeApproval(
    toolCallId: string,
    commitToken: string,
    now: Date,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'committing', commitToken },
      {
        $set: {
          status: 'approved',
          resolvedAt: now,
          commitStartedAt: null,
          commitToken: null,
        },
        $unset: { expiresAt: 1, payload: 1, preview: 1 },
      },
    );
    return res.modifiedCount === 1;
  }

  /** 目标已被后续写入取代时落不可重试终态，避免审批卡无限重试。 */
  async completeSuperseded(
    toolCallId: string,
    commitToken: string,
    now: Date,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'committing', commitToken },
      {
        $set: {
          status: 'superseded',
          resolvedAt: now,
          commitStartedAt: null,
          commitToken: null,
        },
        $unset: { expiresAt: 1, payload: 1, preview: 1 },
      },
    );
    return res.modifiedCount === 1;
  }

  /** 拒绝只允许从 pending 进入 rejected；正在提交的批准不能被并发覆盖。 */
  async reject(toolCallId: string, now: Date): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'pending', expiresAt: { $gt: now } },
      {
        $set: { status: 'rejected', resolvedAt: now },
        $unset: { expiresAt: 1, payload: 1, preview: 1 },
      },
    );
    return res.modifiedCount === 1;
  }

  /**
   * 回收进程中断遗留的过期提交租约。所有审批副作用都必须具备幂等性，才允许重放。
   */
  async reopenStaleApproval(
    toolCallId: string,
    staleBefore: Date,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      {
        _id: toolCallId,
        status: 'committing',
        commitStartedAt: { $lte: staleBefore },
      },
      {
        $set: {
          status: 'pending',
          resolvedAt: null,
          commitStartedAt: null,
          commitToken: null,
        },
      },
    );
    return res.modifiedCount === 1;
  }

  /**
   * 写入在批准后失败时撤销本次裁决，让前端保留同一张审批卡并允许重试。
   * 条件限定为 committing，避免覆盖用户已做出的 reject 或后续正常裁决。
   */
  async reopenAfterFailedApproval(
    toolCallId: string,
    commitToken: string,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'committing', commitToken },
      {
        $set: {
          status: 'pending',
          resolvedAt: null,
          commitStartedAt: null,
          commitToken: null,
        },
      },
    );
    return res.modifiedCount === 1;
  }

  /** 本会话已裁决但还没回灌给模型的记录(供下一轮 chat 注入审批结果)。 */
  async findResolvedUnnotified(sessionKey: string): Promise<PendingWrite[]> {
    return this.model.find({
      sessionKey,
      status: { $in: ['approved', 'rejected', 'superseded'] },
      notifiedToModel: false,
    });
  }

  /** 标记已回灌,避免下轮重复注入。 */
  async markNotified(toolCallIds: string[]): Promise<void> {
    if (toolCallIds.length === 0) return;
    await this.model.updateMany(
      { _id: { $in: toolCallIds } },
      { $set: { notifiedToModel: true } },
    );
  }

  /** 删除会话时清理其完整审批载荷，避免删除后仍残留正文和来源。 */
  async deleteBySessionKey(sessionKey: string): Promise<number> {
    const result = await this.model.deleteMany({ sessionKey });
    return result.deletedCount ?? 0;
  }
}
