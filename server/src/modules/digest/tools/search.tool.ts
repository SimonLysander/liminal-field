/**
 * search — v3：在订阅源里按关键词搜索，可限定源 ref，历史去重，分配 item ref。
 *
 * 设计决策：
 * - sources 可选：不传 = 所有订阅源（从 stcRepo 取），传了 = 按 ref 反查 sourceRefsMap。
 * - 不支持 search 的 fetcher 直接 skip（不 throw），让 LLM 得到所有支持搜索的源结果。
 * - 0 命中是合法结果（status:ok total:0），不当作 error。
 * - 历史去重与 browse 一致：findExistingGuids 批量查。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { TaskContext } from './digest-tools.factory';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('search');

export interface SearchDeps {
  fetcherRegistry: FetcherRegistry;
  pfiRepo: ProcessedFeedItemRepository;
  stcRepo: SmartTopicConfigRepository;
  ctx: TaskContext;
}

export function createSearchTool(deps: SearchDeps) {
  const { fetcherRegistry, pfiRepo, stcRepo, ctx } = deps;

  return tool({
    description:
      '在订阅源里按关键词搜索条目。可选 sources 限定哪些源（用 list_sources 拿的 ref）。' +
      '返回结构同 browse，含 ref 用于 view/pick。0 命中是合法结果，不是错误。',
    inputSchema: jsonSchema<{ query: string; sources?: string[] }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或主题',
          examples: ['Claude 4.7', 'Agent 框架'],
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: '限定的源 ref 列表，不传 = 所有订阅源',
        },
      },
      examples: [
        { query: 'Claude 4.7' },
        { query: 'Agent 框架', sources: ['s1', 's2'] },
      ],
      required: ['query'],
    }),
    execute: async ({
      query,
      sources: sourceRefs,
    }: {
      query: string;
      sources?: string[];
    }) => {
      try {
        // 解析要搜索的源列表
        const targetSources: Array<{
          ref: string;
          source: typeof ctx.sourceRefsMap extends Map<string, infer V>
            ? V
            : never;
        }> = [];

        if (sourceRefs && sourceRefs.length > 0) {
          // 指定了 refs：从 sourceRefsMap 反查
          for (const ref of sourceRefs) {
            const source = ctx.sourceRefsMap.get(ref);
            if (source) targetSources.push({ ref, source });
          }
        } else {
          // 不传 refs = 所有订阅源，从 stcRepo 取
          const config = await stcRepo.findByContentItemId(ctx.topicId);
          if (config) {
            // 优先从 sourceRefsMap 取（可能 list_sources 已分配了 ref），否则动态添加
            for (const [ref, source] of ctx.sourceRefsMap.entries()) {
              if (config.sourceIds.includes(String(source._id))) {
                targetSources.push({ ref, source });
              }
            }
            // 如果 sourceRefsMap 为空（list_sources 未调用），直接从 config.sourceIds 拿
            if (targetSources.length === 0 && config.sourceIds.length > 0) {
              // 没有 ref 分配，用 source._id 当 key 并跳过 ref
              // 仅搜索，不添加到 sourceRefsMap（保持 ref 一致性，需先调 list_sources）
              logger.warn(
                `search: sourceRefsMap 为空，部分源可能无 ref。建议先调 list_sources。 taskId=${ctx.taskId}`,
              );
            }
          }
        }

        const sourcesSearched: string[] = [];
        const allItems: Array<
          FetchedItem & { sourceRef: string; sourceName: string }
        > = [];

        for (const { ref, source } of targetSources) {
          if (!source.enabled) continue;
          const fetcher = fetcherRegistry.get(source.type);
          if (typeof fetcher.search !== 'function') {
            logger.debug(`search: source ${source.name} 不支持 search，跳过`);
            continue;
          }
          try {
            const found = await fetcher.search(source.config, query);
            for (const item of found) {
              allItems.push({
                ...item,
                sourceRef: ref,
                sourceName: source.name,
              });
            }
            sourcesSearched.push(ref);
          } catch (err) {
            logger.warn(
              `search: 搜索 source=${source.name} 失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // 历史去重
        const existingGuids = await pfiRepo.findExistingGuids(
          ctx.topicId,
          allItems.map((i) => i.itemGuid),
        );
        const existingSet = new Set(existingGuids);
        const deduped = allItems.filter((i) => !existingSet.has(i.itemGuid));

        // 按时间倒序
        deduped.sort((a, b) => {
          const ta = a.publishedAt?.getTime() ?? 0;
          const tb = b.publishedAt?.getTime() ?? 0;
          return tb - ta;
        });

        // 分配 item ref，写入 fetchedItemsMap
        const items = deduped.map(
          ({ sourceRef, sourceName, ...fetchedItem }) => {
            ctx.refCounter.item += 1;
            const ref = `i${ctx.refCounter.item}`;
            ctx.fetchedItemsMap.set(ref, {
              fetchedItem,
              sourceRef,
              sourceName,
            });
            return {
              ref,
              title: fetchedItem.title,
              url: fetchedItem.url,
              publishedAt: fetchedItem.publishedAt?.toISOString(),
              snippet: fetchedItem.snippet.slice(0, 200),
            };
          },
        );

        const total = items.length;
        logger.debug(
          `search: query="${query}" sourcesSearched=${sourcesSearched.length} total=${total} taskId=${ctx.taskId}`,
        );

        return toolResult(`搜 '${query}' · 命中 ${total} 条`, undefined, {
          status: 'ok',
          query,
          sourcesSearched,
          items,
          list: items.slice(0, 5).map((i) => i.title),
          total,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`search 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
