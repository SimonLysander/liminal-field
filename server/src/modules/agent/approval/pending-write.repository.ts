import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import {
  PendingWrite,
  type PendingWriteStatus,
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
          status: 'pending' as PendingWriteStatus,
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
}
