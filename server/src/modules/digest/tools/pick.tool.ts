/**
 * pick — v4：把选中的 items 标记为本任务的 findings。
 *
 * 设计决策：
 * - 参数用 ref 数组（不用 itemGuid）：LLM 从 browse 拿到 ref，系统反查 fetchedItemsMap。
 * - citationId 从 task 当前 findings.length + 1 递增（appendFindings 前先 findById）。
 * - 找不到的 ref 进 skippedRefs，全没找到 → errorCode: ALL_REFS_INVALID。
 * - v4 变化：fetchedItemsMap 存的是 sourceId（src_xxx 直接），不再通过 sourceRefsMap 二次反查。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { DigestTaskRepository } from '../digest-task.repository';
import type { Finding } from '../digest-task.entity';
import type { TaskContext } from './digest-tools.factory';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('pick');

export interface PickDeps {
  taskRepo: DigestTaskRepository;
  ctx: TaskContext;
}

export function createPickTool(deps: PickDeps) {
  const { taskRepo, ctx } = deps;

  return tool({
    description:
      '标记这些 item 为本任务的相关 findings。一次调用挑一批，每条带为啥挑的理由。' +
      '所有挑出来的 findings 会作为 agent 工作的最终产物。',
    inputSchema: jsonSchema<{ items: Array<{ ref: string; reason: string }> }>({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              ref: {
                type: 'string',
                description: 'item 的 ref',
                examples: ['i3', 'i7'],
              },
              reason: {
                type: 'string',
                description: '为什么挑这条',
                maxLength: 500,
              },
            },
            required: ['ref', 'reason'],
          },
        },
      },
      examples: [
        {
          items: [
            { ref: 'i3', reason: '直接讨论本期主题' },
            { ref: 'i7', reason: '含具体数据' },
          ],
        },
      ],
      required: ['items'],
    }),
    execute: async ({
      items: picks,
    }: {
      items: Array<{ ref: string; reason: string }>;
    }) => {
      try {
        // 查当前 task findings 数量，决定 citationId 起始值
        const currentTask = await taskRepo.findById(ctx.taskId);
        if (!currentTask) {
          return toolResult('任务不存在，无法保存 findings', undefined, {
            status: 'error',
            errorCode: 'TASK_NOT_FOUND',
          });
        }

        let nextCitationId = currentTask.findings.length + 1;
        const newFindings: Finding[] = [];
        const pickedRefs: string[] = [];
        const skippedRefs: string[] = [];
        const savedItems: Array<{
          title: string;
          reason: string;
          citationId: number;
        }> = [];

        for (const { ref, reason } of picks) {
          const entry = ctx.fetchedItemsMap.get(ref);
          if (!entry) {
            logger.warn(
              `pick: ref "${ref}" 不在 fetchedItemsMap，跳过 (taskId=${ctx.taskId})`,
            );
            skippedRefs.push(ref);
            continue;
          }

          // v4：fetchedItemsMap 直接存 sourceId，不再通过 sourceRefsMap 二次反查
          const { fetchedItem, sourceId, sourceName } = entry;

          const citationId = nextCitationId++;
          newFindings.push({
            citationId,
            sourceId,
            sourceName,
            itemGuid: fetchedItem.itemGuid,
            title: fetchedItem.title,
            url: fetchedItem.url,
            publishedAt: fetchedItem.publishedAt,
            snippet: fetchedItem.snippet.slice(0, 800),
            reason: reason.slice(0, 500),
          });
          pickedRefs.push(ref);
          savedItems.push({ title: fetchedItem.title, reason, citationId });
        }

        if (pickedRefs.length === 0) {
          return toolResult(
            `所有 ref 都无效，跳过 ${skippedRefs.length} 条`,
            undefined,
            {
              status: 'error',
              errorCode: 'ALL_REFS_INVALID',
              skippedRefs,
              saved: 0,
              skipped: skippedRefs.length,
            },
          );
        }

        await taskRepo.appendFindings(ctx.taskId, newFindings);

        const saved = newFindings.length;
        const skipped = skippedRefs.length;

        logger.debug(
          `pick: saved=${saved} skipped=${skipped} taskId=${ctx.taskId}`,
        );

        const citationIds = savedItems.map((s) => s.citationId);

        return toolResult(`挑了 ${saved} 条 · 跳过 ${skipped} 条`, undefined, {
          status: skipped > 0 ? 'partial' : 'ok',
          saved,
          skipped,
          pickedRefs,
          skippedRefs,
          citationIds,
          list: savedItems.map(
            (s) =>
              `[CIT ${s.citationId}] ${s.title} · ${s.reason.slice(0, 30)}`,
          ),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `pick 异常: ${msg}`,
          err instanceof Error ? err.stack : undefined,
        );
        return toolResult(`保存 findings 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
