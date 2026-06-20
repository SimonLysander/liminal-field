/**
 * search_source — 在指定信息源里搜索关键词。
 *
 * 若该 fetcher 未实现 search 方法（search 为 undefined），
 * 返回 status:invalid 提示换工具，不抛异常（让 LLM 换 fetch_source）。
 *
 * 0 命中返回 status:not_found，不当作 ok 静默处理。
 * 同 fetch_source，拿到 items 后通过 onItems 回调注入 fetchedItemsMap。
 */
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import { toolResult } from '../../agent/tools/tool-result';

export interface SearchSourceDeps {
  infoSourceRepo: InfoSourceRepository;
  fetcherRegistry: FetcherRegistry;
  onItems: (items: FetchedItem[]) => void;
}

export function createSearchSourceTool(deps: SearchSourceDeps) {
  const { infoSourceRepo, fetcherRegistry, onItems } = deps;

  return tool({
    description:
      '在指定信息源里按关键词搜索，返回命中条目列表（itemGuid、title、url、snippet）。' +
      '0 命中返回 status:not_found；若该源类型不支持搜索，返回 status:invalid，请改用 fetch_source 拉全量再筛选。' +
      '命中的 itemGuid 可传给 read_item_full 读全文，或传给 save_finding 保存到本期报告。',
    inputSchema: jsonSchema<{
      sourceId: string;
      query: string;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: '信息源 id，来自 list_sources 返回的 meta.sources[].id',
          examples: ['6830a1fc200000001'],
        },
        query: {
          type: 'string',
          description: '搜索关键词或主题，尽量简短精准，不要写完整句子',
          examples: ['AI 监管', '量子计算', '气候变化'],
        },
        limit: {
          type: 'number',
          description: '返回条目上限，默认 20，最多 50',
          minimum: 1,
          maximum: 50,
        },
      },
      examples: [
        { sourceId: '6830a1fc200000001', query: 'AI 监管' },
        { sourceId: '6830a1fc200000001', query: '量子计算', limit: 10 },
      ],
      required: ['sourceId', 'query'],
    }),
    execute: async ({
      sourceId,
      query,
      limit = 20,
    }: {
      sourceId: string;
      query: string;
      limit?: number;
    }) => {
      try {
        const source = await infoSourceRepo.findById(sourceId);
        if (!source) {
          return toolResult(
            '信息源不存在，请用 list_sources 确认可用源',
            undefined,
            {
              status: 'not_found',
              sourceId,
            },
          );
        }
        if (!source.enabled) {
          return toolResult(
            `信息源「${source.name}」已禁用，无法搜索`,
            undefined,
            {
              status: 'invalid',
              sourceId,
            },
          );
        }

        const fetcher = fetcherRegistry.get(source.type);

        // 该 fetcher 不支持 search 能力 → status:invalid 明确告知 LLM，不算 error
        if (typeof fetcher.search !== 'function') {
          return toolResult(
            `「${source.name}」（${source.type}）不支持搜索，请改用 fetch_source 拉全量再筛选`,
            undefined,
            { status: 'invalid', sourceId },
          );
        }

        const items = await fetcher.search(source.config, query, { limit });

        // 注入 fetchedItemsMap，供 save_finding 反查
        onItems(items);

        if (items.length === 0) {
          return toolResult(
            `「${query}」在「${source.name}」中无命中`,
            undefined,
            { status: 'not_found', total: 0 },
          );
        }

        const detail = items
          .map(
            (it) =>
              `[${it.itemGuid}] ${it.title}\n  ${it.url}\n  ${it.snippet.slice(0, 120)}`,
          )
          .join('\n\n');

        // list 给前端 NestedList 渲染（标题 · 摘要截断），不露 itemGuid
        const list = items.map((it) => {
          const snip = it.snippet.replace(/\s+/g, ' ').trim();
          const snipShort = snip.length > 36 ? `${snip.slice(0, 36)}…` : snip;
          return snipShort ? `${it.title} — ${snipShort}` : it.title;
        });

        return toolResult(
          `「${query}」· 「${source.name}」· 命中 ${items.length} 条`,
          detail,
          {
            status: 'ok',
            total: items.length,
            list,
            items: items.map((it) => ({
              itemGuid: it.itemGuid,
              title: it.title,
              url: it.url,
              publishedAt: it.publishedAt?.toISOString(),
              snippet: it.snippet.slice(0, 200),
            })),
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`搜索失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
