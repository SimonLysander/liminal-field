/**
 * fetch_source — 拉取信息源最新条目。
 *
 * 执行后通过 onItems 回调把 FetchedItem[] 注入 taskContext.fetchedItemsMap，
 * 供后续 save_finding 工具根据 itemGuid 反查标题 / url / snippet。
 *
 * 铁律：返回实际条目总数 + hasMore + nextOffset，不静默丢超 limit 的条目；
 * 源不存在 → status:not_found，源已禁用 → status:invalid，不 throw。
 *
 * since 参数由 LLM 传 ISO 字符串，内部转 Date 再传给 fetcher。
 */
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import { toolResult } from '../../agent/tools/tool-result';

export interface FetchSourceDeps {
  infoSourceRepo: InfoSourceRepository;
  fetcherRegistry: FetcherRegistry;
  /** 拉取成功后把 items 注入 fetchedItemsMap 供 save_finding 反查 */
  onItems: (items: FetchedItem[]) => void;
}

export function createFetchSourceTool(deps: FetchSourceDeps) {
  const { infoSourceRepo, fetcherRegistry, onItems } = deps;

  return tool({
    description:
      '拉取指定信息源的最新条目列表（标题、链接、发布时间、摘要），返回 meta.items 含每条的 itemGuid、title、url、snippet。' +
      '若总条目超出 limit，meta.hasMore=true 且带 nextOffset 提示。' +
      '要读某条全文用 itemGuid 调 read_item_full；要把条目存入本期报告用 itemGuid 调 save_finding。',
    inputSchema: jsonSchema<{
      sourceId: string;
      limit?: number;
      since?: string;
    }>({
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: '信息源 id，来自 list_sources 返回的 meta.sources[].id',
          examples: ['6830a1fc200000001'],
        },
        limit: {
          type: 'number',
          description: '返回条目上限，默认 30，最多 50',
          minimum: 1,
          maximum: 50,
        },
        since: {
          type: 'string',
          description:
            'ISO 8601 时间字符串，只取此时间之后发布的条目；不传则拉最新 limit 条',
          examples: ['2026-06-01T00:00:00Z'],
        },
      },
      examples: [
        { sourceId: '6830a1fc200000001' },
        {
          sourceId: '6830a1fc200000001',
          limit: 20,
          since: '2026-06-01T00:00:00Z',
        },
      ],
      required: ['sourceId'],
    }),
    execute: async ({
      sourceId,
      limit = 30,
      since,
    }: {
      sourceId: string;
      limit?: number;
      since?: string;
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
            `信息源「${source.name}」已禁用，无法拉取`,
            undefined,
            {
              status: 'invalid',
              sourceId,
            },
          );
        }

        const fetcher = fetcherRegistry.get(source.type);
        // 多取 1 条判断 hasMore，不静默丢超 limit 的条目
        const raw = await fetcher.fetch(source.config, {
          limit: limit + 1,
          since: since ? new Date(since) : undefined,
        });

        const hasMore = raw.length > limit;
        const items = raw.slice(0, limit);

        // 注入 fetchedItemsMap，供 save_finding 反查
        onItems(items);

        if (items.length === 0) {
          return toolResult(`「${source.name}」暂无新条目`, undefined, {
            status: 'ok',
            total: 0,
            hasMore: false,
            list: [],
          });
        }

        const detail = items
          .map(
            (it) =>
              `[${it.itemGuid}] ${it.title}\n  ${it.url}\n  ${it.publishedAt?.toISOString() ?? '时间未知'}\n  ${it.snippet.slice(0, 120)}`,
          )
          .join('\n\n');

        // list 给前端 NestedList 渲染（标题 · 发布时间），不露 itemGuid
        const list = items.map((it) => {
          const date = it.publishedAt
            ? it.publishedAt.toISOString().slice(0, 10)
            : '时间未知';
          return `${it.title} · ${date}`;
        });

        return toolResult(
          `「${source.name}」· 取到 ${items.length}${hasMore ? '+' : ''} 条`,
          detail,
          {
            status: 'ok',
            total: items.length,
            hasMore,
            ...(hasMore ? { nextOffset: limit } : {}),
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
        return toolResult(`拉取信息源失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
