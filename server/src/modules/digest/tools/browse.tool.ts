/**
 * browse — v3：拉某个信息源过去 7 天的最新条目，历史去重，分配 item ref（i1, i2...）。
 *
 * 设计决策：
 * - 参数只有 source（ref 字符串）：LLM 从 list_sources 拿 ref，系统从 sourceRefsMap 反查实体。
 * - 历史去重：查 ProcessedFeedItemRepository.findExistingGuids，剔掉已 pick 过的。
 * - item ref 全局自增（不随 browse 重置），避免 LLM 混淆不同批次里相同 i3。
 * - fetchedItemsMap 写入：后续 view/pick 工具通过 ref 反查完整 item。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import type { TaskContext } from './digest-tools.factory';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('browse');

const SINCE_DAYS = 7;

export interface BrowseDeps {
  fetcherRegistry: FetcherRegistry;
  pfiRepo: ProcessedFeedItemRepository;
  ctx: TaskContext;
}

export function createBrowseTool(deps: BrowseDeps) {
  const { fetcherRegistry, pfiRepo, ctx } = deps;

  return tool({
    description:
      '拉某个信息源过去 7 天的最新条目（已跟历史推过的条目去重）。' +
      '返回 items 含 ref（临时引用号，用于 view / pick）、title、url、publishedAt、snippet。' +
      'snippet 不够判断时用 view({ref}) 拉全文。要跨源/定向找用 search。',
    inputSchema: jsonSchema<{ source: string }>({
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: '信息源的 ref（从 list_sources 返回里拿）',
          examples: ['s1', 's2'],
        },
      },
      examples: [{ source: 's1' }],
      required: ['source'],
    }),
    execute: async ({ source: sourceRef }: { source: string }) => {
      try {
        const infoSource = ctx.sourceRefsMap.get(sourceRef);
        if (!infoSource) {
          return toolResult(
            `信息源 ref "${sourceRef}" 不存在，请先调 list_sources 拿 ref`,
            undefined,
            { status: 'error', errorCode: 'SOURCE_NOT_FOUND', sourceRef },
          );
        }

        if (!infoSource.enabled) {
          return toolResult(`信息源「${infoSource.name}」已禁用`, undefined, {
            status: 'error',
            errorCode: 'SOURCE_DISABLED',
            sourceRef,
          });
        }

        const since = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);
        const fetcher = fetcherRegistry.get(infoSource.type);

        let rawItems: Awaited<ReturnType<typeof fetcher.fetch>>;
        try {
          rawItems = await fetcher.fetch(infoSource.config, { since });
        } catch (fetchErr: unknown) {
          const reason =
            fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          logger.warn(
            `browse fetch 失败: sourceRef=${sourceRef} reason=${reason}`,
          );
          return toolResult(`拉取「${infoSource.name}」失败`, undefined, {
            status: 'error',
            errorCode: 'SOURCE_FETCH_FAILED',
            sourceRef,
            reason,
          });
        }

        const totalFetched = rawItems.length;

        // 历史去重：剔掉已被 pick 写入 ProcessedFeedItem 的 guid
        const existingGuids = await pfiRepo.findExistingGuids(
          ctx.topicId,
          rawItems.map((i) => i.itemGuid),
        );
        const existingSet = new Set(existingGuids);
        const deduped = rawItems.filter((i) => !existingSet.has(i.itemGuid));
        const afterDedupe = deduped.length;

        // 分配 item ref，写入 fetchedItemsMap
        const items = deduped.map((fetchedItem) => {
          ctx.refCounter.item += 1;
          const ref = `i${ctx.refCounter.item}`;
          ctx.fetchedItemsMap.set(ref, {
            fetchedItem,
            sourceRef,
            sourceName: infoSource.name,
          });
          return {
            ref,
            title: fetchedItem.title,
            url: fetchedItem.url,
            publishedAt: fetchedItem.publishedAt?.toISOString(),
            snippet: fetchedItem.snippet.slice(0, 200),
          };
        });

        logger.debug(
          `browse: source=${infoSource.name} totalFetched=${totalFetched} afterDedupe=${afterDedupe} taskId=${ctx.taskId}`,
        );

        return toolResult(
          `${infoSource.name} 过去 7 天 ${afterDedupe} 条（拉 ${totalFetched} / 历史去重剩 ${afterDedupe}）`,
          undefined,
          {
            status: 'ok',
            sourceRef,
            sourceName: infoSource.name,
            since: since.toISOString(),
            totalFetched,
            afterDedupe,
            items,
            list: items.slice(0, 5).map((i) => i.title),
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`browse 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
