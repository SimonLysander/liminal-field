/**
 * PendingWriteCommitService — HITL 审批的「commit 分派器」。
 *
 * approve：
 *   1. 按 toolCallId 查 pending 记录 → 不存在/sessionKey 不符则短路返回
 *   2. resolve(approved) → 若已裁决则 already_resolved（防竞态重复审批）
 *   3. 按 toolName 分派对应仓储调用，真正落库
 *
 * reject：仅标 rejected，不执行任何写操作。
 *
 * 写逻辑复用各工具导出的 helper（extractTitle / serializeToDraftMarkdown 等），
 * 确保 commit 路径与工具 execute 行为完全等价，不产生逻辑分叉。
 */
import { Injectable, Logger } from '@nestjs/common';
import { PendingWriteRepository } from './pending-write.repository';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import {
  extractTitle,
  extractSummary,
  composeAiDraftBody,
  type DraftSource,
} from '../tools/write-draft.tool';
import {
  serializeToDraftMarkdown,
  type PlanItem,
} from '../tools/write-learn-plan.tool';
import { normalizeTasks } from '../tools/write-tasks.tool';
import {
  toObservationItems,
  type ObservationInput,
} from '../tools/remember.tool';

export type CommitStatus =
  | 'ok'
  | 'not_found'
  | 'forbidden'
  | 'already_resolved';

@Injectable()
export class PendingWriteCommitService {
  private readonly logger = new Logger(PendingWriteCommitService.name);

  constructor(
    private readonly pendingWriteRepo: PendingWriteRepository,
    private readonly editorDraftRepo: EditorDraftRepository,
    private readonly memoryRepo: AgentMemoryRepository,
    private readonly observationRepo: AgentMemoryObservationRepository,
  ) {}

  async approve(
    toolCallId: string,
    sessionKey: string,
  ): Promise<{ status: CommitStatus }> {
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
    // resolve 用 findOneAndUpdate where status='pending'，返回 false 说明已被裁决（防竞态）
    const resolved = await this.pendingWriteRepo.resolve(
      toolCallId,
      'approved',
      now,
    );
    if (!resolved) {
      this.logger.warn(
        `approve: 记录已被裁决 toolCallId=${toolCallId} toolName=${pending.toolName}`,
      );
      return { status: 'already_resolved' };
    }

    const { toolName, payload } = pending;
    this.logger.log(
      `approve: commit toolCallId=${toolCallId} toolName=${toolName} sessionKey=${sessionKey}`,
    );

    try {
      switch (toolName) {
        case 'write_draft': {
          // 写逻辑与 write-draft.tool.ts execute 完全等价（复用同一 helper）
          const markdown = payload['markdown'] as string;
          const sources =
            (payload['sources'] as DraftSource[] | undefined) ?? [];
          if (!pending.targetContentItemId) {
            // 已标 approved 却没目标可写 → 抛错走 catch(500),绝不静默返回 ok 误导回灌
            throw new Error(
              `write_draft commit 缺少 targetContentItemId toolCallId=${toolCallId}`,
            );
          }
          await this.editorDraftRepo.saveAiDraft({
            contentItemId: pending.targetContentItemId,
            // composeAiDraftBody:[@#CIT N] 转链接 + 篇末「来源」小节,与工具 execute 同一处合成
            bodyMarkdown: composeAiDraftBody(markdown, sources),
            title: extractTitle(markdown),
            summary: extractSummary(markdown),
            changeNote: 'learn-draft',
            savedAt: now,
          });
          break;
        }

        case 'write_learn_plan': {
          // 写逻辑与 write-learn-plan.tool.ts execute 完全等价
          const goal = payload['goal'] as string;
          const understanding = payload['understanding'] as string;
          const items = payload['items'] as PlanItem[];
          if (!pending.targetContentItemId) {
            throw new Error(
              `write_learn_plan commit 缺少 targetContentItemId toolCallId=${toolCallId}`,
            );
          }
          const bodyMarkdown = serializeToDraftMarkdown(
            goal,
            understanding,
            items,
          );
          const summary =
            understanding.split(/[。！？\n]/)[0]?.slice(0, 100) ?? '';
          await this.editorDraftRepo.saveAiDraft({
            contentItemId: pending.targetContentItemId,
            bodyMarkdown,
            title: goal,
            summary,
            changeNote: 'learn-plan',
            savedAt: now,
          });
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
          await this.memoryRepo.setTasks(
            pending.agentKey,
            normalizeTasks(tasks),
          );
          break;
        }

        case 'remember': {
          // 写逻辑与 remember.tool.ts execute 完全等价（复用 toObservationItems）
          // 注意：gateWrite 的 validate=validateObservations 已在暂存前校验过，
          // 此处 payload 中的 observations 一定是合法的，无需再次校验。
          const observations = payload['observations'] as ObservationInput;
          await this.observationRepo.appendMany(
            toObservationItems(observations, pending.sessionKey),
          );
          break;
        }

        default:
          this.logger.warn(
            `approve: 未知 toolName=${toolName}，已标 approved 但无 commit 逻辑 toolCallId=${toolCallId}`,
          );
      }
    } catch (err) {
      const stack = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `approve: commit 失败 toolCallId=${toolCallId} toolName=${toolName} err=${stack}`,
      );
      throw err; // 让端点返回 500，让调用方感知写失败
    }

    return { status: 'ok' };
  }

  async reject(
    toolCallId: string,
    sessionKey: string,
  ): Promise<{ status: CommitStatus }> {
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

    const resolved = await this.pendingWriteRepo.resolve(
      toolCallId,
      'rejected',
      new Date(),
    );
    if (!resolved) {
      return { status: 'already_resolved' };
    }

    this.logger.log(
      `reject: toolCallId=${toolCallId} toolName=${pending.toolName} sessionKey=${sessionKey}`,
    );

    return { status: 'ok' };
  }
}
