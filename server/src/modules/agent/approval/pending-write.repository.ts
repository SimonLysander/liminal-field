import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { PendingWrite, type PendingWriteStatus } from './pending-write.entity';

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

/**
 * PendingWriteRepository — 待审批写入的存取。
 * upsert by _id(toolCallId);审批端点按 _id 取出复算;裁决后标 status + resolvedAt。
 */
@Injectable()
export class PendingWriteRepository {
  constructor(
    @Inject(getModelToken(PendingWrite.name))
    private readonly model: ReturnModelType<typeof PendingWrite>,
  ) {}

  async stash(input: StashPendingWriteInput): Promise<void> {
    await this.model.findByIdAndUpdate(
      input.toolCallId,
      {
        $set: {
          sessionKey: input.sessionKey,
          toolName: input.toolName,
          targetContentItemId: input.targetContentItemId ?? null,
          agentKey: input.agentKey ?? null,
          payload: input.payload,
          preview: input.preview ?? {},
          status: 'pending',
          createdAt: input.now,
          resolvedAt: null,
        },
      },
      { upsert: true },
    );
  }

  async findById(toolCallId: string): Promise<PendingWrite | null> {
    return this.model.findById(toolCallId);
  }

  /**
   * 会话加载时批量取审批状态，避免历史消息中的每张卡各发一次请求。
   * TTL 已清理的记录不在这里伪造状态，由生命周期层结合消息历史标为 expired。
   */
  async findStatusesBySessionKey(
    sessionKey: string,
  ): Promise<Record<string, PendingWriteStatus>> {
    const writes = await this.model.find({ sessionKey }, { _id: 1, status: 1 });
    return Object.fromEntries(writes.map((write) => [write._id, write.status]));
  }

  /** 裁决:只在仍 pending 时翻转(防重复审批 / 竞态),返回是否成功翻转。 */
  async resolve(
    toolCallId: string,
    status: 'approved' | 'rejected',
    now: Date,
  ): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'pending' },
      { $set: { status, resolvedAt: now } },
    );
    return res.modifiedCount === 1;
  }

  /**
   * 写入在批准后失败时撤销本次裁决，让前端保留同一张审批卡并允许重试。
   * 条件限定为 approved，避免覆盖用户已做出的 reject 或后续正常裁决。
   */
  async reopenAfterFailedApproval(toolCallId: string): Promise<boolean> {
    const res = await this.model.updateOne(
      { _id: toolCallId, status: 'approved' },
      { $set: { status: 'pending', resolvedAt: null } },
    );
    return res.modifiedCount === 1;
  }

  /** 本会话已裁决但还没回灌给模型的记录(供下一轮 chat 注入审批结果)。 */
  async findResolvedUnnotified(sessionKey: string): Promise<PendingWrite[]> {
    return this.model.find({
      sessionKey,
      status: { $in: ['approved', 'rejected'] },
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
}
