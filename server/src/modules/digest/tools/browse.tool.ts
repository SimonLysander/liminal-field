/**
 * browse — v4：拉某个信息源过去 7 天的最新条目，历史去重，分配 item ref（i1, i2...）。
 *
 * 设计决策（v4 vs v3 的变化）：
 * - 参数改为 sourceId（src_xxx），不再用 s1/s2 ref——源列表已由 system prompt 注入 LLM，
 *   LLM 直接传 sourceId 即可，不需要 list_sources 分配 ref 再反查。
 * - 不再依赖 sourceRefsMap（已从 TaskContext 删除），改为 infoSourceRepo.findById 按需查。
 * - fetchedItemsMap 改为存 sourceId（而非 sourceRef），pick 工具取 sourceId 不变。
 * - 错误码 SOURCE_NOT_FOUND 保留，SOURCE_DISABLED 保留。
 * - 历史去重、item ref 分配逻辑不变。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import type { TaskContext } from './digest-tools.factory';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('browse');

const SINCE_DAYS = 7;

export interface BrowseDeps {
  infoSourceRepo: InfoSourceRepository;
  fetcherRegistry: FetcherRegistry;
  pfiRepo: ProcessedFeedItemRepository;
  ctx: TaskContext;
}

export function createBrowseTool(deps: BrowseDeps) {
  const { infoSourceRepo, fetcherRegistry, pfiRepo, ctx } = deps;

  return tool({
    description:
      '拉某个订阅信息源过去 7 天的最新条目（已跟历史推过的条目去重）。' +
      'sourceId 从 system prompt 的订阅源列表里取（格式 src_xxx）。' +
      '返回 items 含 ref（临时引用号，用于 pick）、title、url、publishedAt、snippet。' +
      '订阅源不够覆盖时，用 web_search 补刀。',
    inputSchema: jsonSchema<{ sourceId: string; limit?: number }>({
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'src_xxx 格式的信息源 ID，由 system prompt 给出',
          examples: ['src_abc123', 'src_def456'],
        },
        limit: {
          type: 'number',
          description: '最多返回多少条，1-100，默认 20',
        },
      },
      examples: [
        { sourceId: 'src_abc123' },
        { sourceId: 'src_abc123', limit: 30 },
      ],
      required: ['sourceId'],
    }),
    execute: async ({
      sourceId,
      limit = 20,
    }: {
      sourceId: string;
      limit?: number;
    }) => {
      try {
        // 按需从 DB 查询信息源（不再依赖 sourceRefsMap，直接 repo 查）
        const infoSource = await infoSourceRepo.findById(sourceId);
        if (!infoSource) {
          return toolResult(`信息源 "${sourceId}" 不存在`, undefined, {
            status: 'error',
            errorCode: 'SOURCE_NOT_FOUND',
            sourceId,
          });
        }

        if (!infoSource.enabled) {
          return toolResult(`信息源「${infoSource.name}」已禁用`, undefined, {
            status: 'error',
            errorCode: 'SOURCE_DISABLED',
            sourceId,
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
            `browse fetch 失败: sourceId=${sourceId} reason=${reason}`,
          );
          return toolResult(`拉取「${infoSource.name}」失败`, undefined, {
            status: 'error',
            errorCode: 'SOURCE_FETCH_FAILED',
            sourceId,
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

        // 取前 limit 条，避免 LLM context 溢出
        const capped = deduped.slice(0, limit);

        // 分配 item ref，写入 fetchedItemsMap（browse → pick 的数据桥梁）
        const items = capped.map((fetchedItem) => {
          ctx.refCounter.item += 1;
          const ref = `i${ctx.refCounter.item}`;
          ctx.fetchedItemsMap.set(ref, {
            fetchedItem,
            sourceId,
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
          `browse: source=${infoSource.name} totalFetched=${totalFetched} afterDedupe=${afterDedupe} returned=${items.length} taskId=${ctx.taskId}`,
        );

        return toolResult(
          `${infoSource.name} 过去 7 天 ${afterDedupe} 条（拉 ${totalFetched} / 历史去重剩 ${afterDedupe}）`,
          undefined,
          {
            status: 'ok',
            sourceId,
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
        logger.error(
          `browse 异常: sourceId=${sourceId} msg=${msg}`,
          err instanceof Error ? err.stack : undefined,
        );
        return toolResult(`browse 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
