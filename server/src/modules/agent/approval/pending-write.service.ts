/**
 * PendingWriteCommitService — HITL 审批的「commit 分派器」。
 *
 * approve：
 *   1. 按 toolCallId 查 pending 记录 → 不存在/sessionKey 不符则短路返回
 *   2. 原子 claim 为 committing，防竞态重复执行
 *   3. 执行幂等副作用，成功后才 complete 为 approved；失败退回 pending
 *
 * reject：仅标 rejected，不执行任何写操作。
 *
 * 写逻辑复用各工具或 workspace 存储边界导出的 helper，
 * 确保 commit 路径与工具 execute 行为完全等价，不产生逻辑分叉。
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildApprovalFence } from '../../../common/approval-fence';
import { PendingWriteRepository } from './pending-write.repository';
import {
  toPendingWriteApproval,
  type PendingWrite,
  type PendingWriteApproval,
} from './pending-write.entity';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import { commitDraftWrite } from '../tools/write-draft.tool';
import { ApprovalSupersededError } from './approval-superseded.error';
import { validateLearnPlanInput } from '../tools/write-learn-plan.tool';
import {
  serializeLearnPlanDocument,
  type LearnPlanItem,
} from '../../workspace/learn-plan-document';
import { normalizeTasks } from '../tools/write-tasks.tool';
import {
  toObservationItems,
  validateObservations,
  type ObservationInput,
} from '../tools/remember.tool';

export type CommitStatus =
  | 'ok'
  | 'not_found'
  | 'forbidden'
  | 'expired'
  | 'in_progress'
  | 'superseded'
  | 'already_resolved';

export type CommitResult =
  | { status: 'ok' | 'superseded'; resolvedAt: Date }
  | {
      status: 'already_resolved';
      /** Mongo 中的真实终态，供其他设备精确同步。 */
      resolution: 'approved' | 'rejected';
      resolvedAt: Date;
    }
  | {
      status: Exclude<CommitStatus, 'ok' | 'superseded' | 'already_resolved'>;
    };

const APPROVAL_LEASE_MS = 30_000;

function isExpiredPending(
  write: { status?: string; expiresAt?: Date },
  now: Date,
): boolean {
  return (
    write.status === 'pending' &&
    write.expiresAt instanceof Date &&
    write.expiresAt.getTime() <= now.getTime()
  );
}

function existingResolution(
  write: Pick<PendingWrite, 'status' | 'expiresAt' | 'resolvedAt'>,
): CommitResult | null {
  if (
    write.status !== 'approved' &&
    write.status !== 'rejected' &&
    write.status !== 'superseded'
  ) {
    return null;
  }
  const approval = toPendingWriteApproval(write, new Date());
  if (approval.status === 'superseded') {
    return { status: 'superseded', resolvedAt: approval.resolvedAt };
  }
  if (approval.status === 'approved' || approval.status === 'rejected') {
    return {
      status: 'already_resolved',
      resolution: approval.status,
      resolvedAt: approval.resolvedAt,
    };
  }
  return null;
}

@Injectable()
export class PendingWriteCommitService {
  private readonly logger = new Logger(PendingWriteCommitService.name);

  constructor(
    private readonly pendingWriteRepo: PendingWriteRepository,
    private readonly editorDraftRepo: EditorDraftRepository,
    private readonly memoryRepo: AgentMemoryRepository,
    private readonly observationRepo: AgentMemoryObservationRepository,
  ) {}

  /** 精确读取单张审批卡，供跨设备慢提交按 callId 收敛到权威终态。 */
  async getApproval(
    toolCallId: string,
    sessionKey: string,
  ): Promise<PendingWriteApproval | null> {
    const write = await this.pendingWriteRepo.findById(toolCallId);
    if (!write || write.sessionKey !== sessionKey) return null;
    return toPendingWriteApproval(write, new Date());
  }

  async approve(toolCallId: string, sessionKey: string): Promise<CommitResult> {
    const pending = await this.pendingWriteRepo.findById(toolCallId);
    if (!pending) {
      this.logger.warn(`approve: 未找到 pending 记录 toolCallId=${toolCallId}`);
      return { status: 'not_found' };
    }
    if (pending.sessionKey !== sessionKey) {
      this.logger.warn(
        `approve: sessionKey 不符 toolCallId=${toolCallId} expected=${pending.sessionKey} got=${sessionKey}`,
      );
      return { status: 'forbidden' };
    }

    const now = new Date();
    if (isExpiredPending(pending, now)) {
      return { status: 'expired' };
    }
    if (pending.status === 'committing') {
      const reopened = await this.pendingWriteRepo.reopenStaleApproval(
        toolCallId,
        new Date(now.getTime() - APPROVAL_LEASE_MS),
      );
      if (!reopened) {
        return { status: 'in_progress' };
      }
      this.logger.warn(
        `approve: 接管过期提交租约 toolCallId=${toolCallId} toolName=${pending.toolName}`,
      );
    } else {
      const resolved = existingResolution(pending);
      if (resolved) return resolved;
    }
    if (!pending.payload) {
      // 终态裁决会主动清除大字段；初次读取与并发裁决之间可能发生状态翻转。
      // 在报数据损坏前重读一次，避免把正常的跨设备审批竞态误判为异常。
      const latest = await this.pendingWriteRepo.findById(toolCallId);
      if (latest) {
        const resolved = existingResolution(latest);
        if (resolved) return resolved;
      }
      if (latest && isExpiredPending(latest, now)) {
        return { status: 'expired' };
      }
      throw new Error(
        `approve: pending 记录缺少 payload toolCallId=${toolCallId}`,
      );
    }

    const commitToken = randomUUID();
    const claim = await this.pendingWriteRepo.claimApproval(
      toolCallId,
      commitToken,
      now,
    );
    if (!claim) {
      this.logger.warn(
        `approve: 未取得提交权 toolCallId=${toolCallId} toolName=${pending.toolName}`,
      );
      const latest = await this.pendingWriteRepo.findById(toolCallId);
      if (latest) {
        const resolved = existingResolution(latest);
        if (resolved) return resolved;
      }
      if (latest && isExpiredPending(latest, now)) {
        return { status: 'expired' };
      }
      return { status: 'in_progress' };
    }
    const commitFence = buildApprovalFence(
      claim.fenceSequence,
      claim.commitVersion,
    );

    const { toolName, payload } = pending;
    this.logger.log(
      `approve: commit toolCallId=${toolCallId} toolName=${toolName} sessionKey=${sessionKey}`,
    );

    try {
      switch (toolName) {
        case 'write_draft': {
          if (!pending.targetContentItemId) {
            // 已标 approved 却没目标可写 → 抛错走 catch(500),绝不静默返回 ok 误导回灌
            throw new Error(
              `write_draft commit 缺少 targetContentItemId toolCallId=${toolCallId}`,
            );
          }
          // 与直写路径共用同一个落库入口，避免审批后退化成全文覆盖。
          await commitDraftWrite(
            this.editorDraftRepo,
            pending.targetContentItemId,
            payload,
            now,
            commitFence,
          );
          break;
        }

        case 'write_learn_plan': {
          // 新调用在门禁入队前已强制 conclusion；这里仅兼容发版时已在
          // Mongo 中等待审批的旧版规划，避免部署后同一张审批卡永久失败。
          const validationError = validateLearnPlanInput(payload, {
            allowMissingConclusion: true,
          });
          if (validationError) {
            throw new Error(validationError);
          }
          // 写逻辑与 write-learn-plan.tool.ts execute 完全等价
          const goal = payload['goal'] as string;
          const understanding = payload['understanding'] as string;
          const items = payload['items'] as LearnPlanItem[];
          // 兼容升级前已经进入审批队列的规划；新工具 schema 会强制提供 conclusion。
          const conclusion =
            (payload['conclusion'] as string | undefined) ?? '';
          if (!pending.targetContentItemId) {
            throw new Error(
              `write_learn_plan commit 缺少 targetContentItemId toolCallId=${toolCallId}`,
            );
          }
          const bodyMarkdown = serializeLearnPlanDocument({
            goal,
            understanding,
            items,
            conclusion,
          });
          const summary =
            understanding.split(/[。！？\n]/)[0]?.slice(0, 100) ?? '';
          const written = await this.editorDraftRepo.saveAiDraftFenced(
            {
              contentItemId: pending.targetContentItemId,
              bodyMarkdown,
              title: goal,
              summary,
              changeNote: 'learn-plan',
              savedAt: now,
            },
            commitFence,
          );
          if (!written) {
            throw new ApprovalSupersededError(
              `write_learn_plan 提交版本已过期 toolCallId=${toolCallId}`,
            );
          }
          break;
        }

        case 'write_tasks': {
          // 写逻辑与 write-tasks.tool.ts execute 完全等价（复用 normalizeTasks）
          const tasks = payload['tasks'] as Array<{
            title: string;
            status?: string;
          }>;
          if (!pending.agentKey) {
            throw new Error(
              `write_tasks commit 缺少 agentKey toolCallId=${toolCallId}`,
            );
          }
          const written = await this.memoryRepo.setTasksFenced(
            pending.agentKey,
            normalizeTasks(tasks),
            commitFence,
          );
          if (!written) {
            throw new ApprovalSupersededError(
              `write_tasks 提交版本已过期 toolCallId=${toolCallId}`,
            );
          }
          break;
        }

        case 'remember': {
          // 写逻辑与 remember.tool.ts execute 完全等价（复用 toObservationItems）
          // 提交时再次校验，防止旧队列或异常数据绕过门禁写入。
          const observations = payload['observations'] as ObservationInput;
          const validationError = validateObservations(observations);
          if (validationError) {
            throw new Error(validationError);
          }
          await this.observationRepo.appendManyIdempotent(
            toolCallId,
            toObservationItems(observations, pending.sessionKey),
          );
          break;
        }

        default:
          throw new Error(
            `approve: 未知 toolName=${toolName} toolCallId=${toolCallId}`,
          );
      }

      const completedAt = new Date();
      const completed = await this.pendingWriteRepo.completeApproval(
        toolCallId,
        commitToken,
        completedAt,
      );
      if (!completed) {
        throw new Error(
          `approve: 副作用完成但审批状态落库失败 toolCallId=${toolCallId}`,
        );
      }
      return { status: 'ok', resolvedAt: completedAt };
    } catch (err) {
      if (err instanceof ApprovalSupersededError) {
        const resolvedAt = new Date();
        const completed = await this.pendingWriteRepo.completeSuperseded(
          toolCallId,
          commitToken,
          resolvedAt,
        );
        if (!completed) {
          throw new Error(
            `approve: 无法记录 superseded 终态 toolCallId=${toolCallId}`,
          );
        }
        this.logger.warn(
          `approve: 已被后续写入取代 toolCallId=${toolCallId} toolName=${toolName}`,
        );
        return { status: 'superseded', resolvedAt };
      }
      const stack = err instanceof Error ? err.stack : String(err);
      let reopened = false;
      // 所有审批副作用均为覆盖写或带幂等键的追加写，因此失败后可安全重放。
      try {
        reopened = await this.pendingWriteRepo.reopenAfterFailedApproval(
          toolCallId,
          commitToken,
        );
      } catch (reopenErr) {
        this.logger.error(
          `approve: 恢复 pending 失败 toolCallId=${toolCallId} toolName=${toolName} err=${reopenErr instanceof Error ? reopenErr.stack : String(reopenErr)}`,
        );
      }
      this.logger.error(
        `approve: commit 失败 toolCallId=${toolCallId} toolName=${toolName} reopened=${reopened} err=${stack}`,
      );
      throw err;
    }
  }

  async reject(toolCallId: string, sessionKey: string): Promise<CommitResult> {
    const pending = await this.pendingWriteRepo.findById(toolCallId);
    if (!pending) {
      this.logger.warn(`reject: 未找到 pending 记录 toolCallId=${toolCallId}`);
      return { status: 'not_found' };
    }
    if (pending.sessionKey !== sessionKey) {
      this.logger.warn(
        `reject: sessionKey 不符 toolCallId=${toolCallId} expected=${pending.sessionKey} got=${sessionKey}`,
      );
      return { status: 'forbidden' };
    }
    const existing = existingResolution(pending);
    if (existing) return existing;
    const now = new Date();
    if (isExpiredPending(pending, now)) {
      return { status: 'expired' };
    }
    if (pending.status === 'committing') {
      return { status: 'in_progress' };
    }

    const resolved = await this.pendingWriteRepo.reject(toolCallId, now);
    if (!resolved) {
      const latest = await this.pendingWriteRepo.findById(toolCallId);
      if (latest) {
        const existing = existingResolution(latest);
        if (existing) return existing;
      }
      if (latest && isExpiredPending(latest, now)) {
        return { status: 'expired' };
      }
      return { status: 'in_progress' };
    }

    this.logger.log(
      `reject: toolCallId=${toolCallId} toolName=${pending.toolName} sessionKey=${sessionKey}`,
    );

    return { status: 'ok', resolvedAt: now };
  }
}
