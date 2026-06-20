/**
 * save_finding — 把 LLM 挑选的条目保存到本期 DigestTask.findings。
 *
 * 设计关键点：
 * 1. LLM 只知道 itemGuid，不知道 title/url/snippet；这些信息在 fetch/search 时
 *    已通过 onItems 回调写入 taskContext.fetchedItemsMap（key=itemGuid）。
 * 2. citationId 在此处原子分配：先查 task 当前 findings.length，再递增。
 *    用 DigestTaskRepository.findById + appendFindings 保证原子性
 *    （appendFindings 内部用 $push $each，不覆盖并发写入）。
 * 3. LLM 编造了不存在的 itemGuid → 跳过 + warn，返回 status:partial，
 *    summary 写明 saved/skipped 计数，skippedGuids 列在 meta 供排查。
 * 4. sourceName 从 InfoSourceRepository 取（LLM 传了 sourceId）。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { DigestTaskRepository } from '../digest-task.repository';
import type { InfoSourceRepository } from '../info-source.repository';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import type { Finding } from '../digest-task.entity';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('save_finding');

export interface TaskContext {
  taskId: string;
  /** fetch / search 工具执行后把 items 注入此 map，key=itemGuid */
  fetchedItemsMap: Map<string, FetchedItem>;
}

export interface SaveFindingDeps {
  taskRepo: DigestTaskRepository;
  infoSourceRepo: InfoSourceRepository;
  taskContext: TaskContext;
}

export function createSaveFindingTool(deps: SaveFindingDeps) {
  const { taskRepo, infoSourceRepo, taskContext } = deps;

  return tool({
    description:
      '把你认为本期相关的条目批量保存到 findings 中（每条自动分配 [CIT N] 引用编号，compose 阶段用）。' +
      '只传已经 fetch_source / search_source 拿到的 itemGuid——未拿到的会被跳过并在 meta.skippedGuids 列出（status:partial）。' +
      '保存前先用 get_recent_picks 排除近期已推送内容，避免重复。',
    inputSchema: jsonSchema<{
      itemGuids: string[];
      sourceId: string;
      reason: string;
    }>({
      type: 'object',
      properties: {
        itemGuids: {
          type: 'array',
          items: { type: 'string' },
          description:
            '要保存的 itemGuid 列表，来自 fetch_source / search_source 返回的 meta.items[].itemGuid',
          examples: [['https://example.com/article-123', 'guid-abc-456']],
          minItems: 1,
          maxItems: 50,
        },
        sourceId: {
          type: 'string',
          description: '这批条目来自哪个信息源的 id（来自 list_sources）',
          examples: ['6830a1fc200000001'],
        },
        reason: {
          type: 'string',
          description: '为什么挑选这批条目（一句话，用于可观测性日志）',
          examples: [
            '与本期 AI 监管主题高度相关',
            '近一周最受关注的量子计算进展',
          ],
        },
      },
      examples: [
        {
          itemGuids: ['https://example.com/article-123'],
          sourceId: '6830a1fc200000001',
          reason: '与本期主题相关',
        },
      ],
      required: ['itemGuids', 'sourceId', 'reason'],
    }),
    execute: async ({
      itemGuids,
      sourceId,
      reason,
    }: {
      itemGuids: string[];
      sourceId: string;
      reason: string;
    }) => {
      try {
        // 查 source 获取 sourceName（给 Finding.sourceName 填值）
        const source = await infoSourceRepo.findById(sourceId);
        const sourceName = source?.name ?? sourceId;

        // 当前 task findings 数量 → 决定 citationId 起始值
        const currentTask = await taskRepo.findById(taskContext.taskId);
        if (!currentTask) {
          return toolResult('任务不存在，无法保存 findings', undefined, {
            status: 'error',
          });
        }

        let nextCitationId = currentTask.findings.length + 1;
        const newFindings: Finding[] = [];
        const skippedGuids: string[] = [];

        for (const guid of itemGuids) {
          const item = taskContext.fetchedItemsMap.get(guid);
          if (!item) {
            // LLM 给了不存在的 guid → 跳过，记录可观测性日志
            logger.warn(
              `save_finding: itemGuid "${guid}" 不在 fetchedItemsMap 中，跳过 (taskId=${taskContext.taskId})`,
            );
            skippedGuids.push(guid);
            continue;
          }

          newFindings.push({
            citationId: nextCitationId++,
            sourceId,
            sourceName,
            itemGuid: guid,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            snippet: item.snippet.slice(0, 800), // 存摘要，compose 用
            reason,
          });
        }

        if (newFindings.length > 0) {
          await taskRepo.appendFindings(taskContext.taskId, newFindings);
        }

        logger.debug(
          `save_finding: saved=${newFindings.length} skipped=${skippedGuids.length} taskId=${taskContext.taskId}`,
        );

        // 有跳过 → status:partial，明确写明 saved/skipped 计数
        const hasSkipped = skippedGuids.length > 0;
        const summary = hasSkipped
          ? `已保存 ${newFindings.length} 条，跳过 ${skippedGuids.length} 条（itemGuid 未拿到，详见 meta.skippedGuids）`
          : `已保存 ${newFindings.length} 条 finding`;

        // list 给前端 NestedList 渲染（标题 · 来源），不露 itemGuid
        const list = newFindings.map(
          (f) => `[CIT ${f.citationId}] ${f.title} · ${sourceName}`,
        );

        return toolResult(summary, undefined, {
          status: hasSkipped ? 'partial' : 'ok',
          saved: newFindings.length,
          skipped: skippedGuids.length,
          list,
          ...(hasSkipped ? { skippedGuids } : {}),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `save_finding 异常: ${msg}`,
          err instanceof Error ? err.stack : undefined,
        );
        return toolResult(`保存 findings 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
