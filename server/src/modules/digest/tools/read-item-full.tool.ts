/**
 * read_item_full — 拉取指定 item 的全文内容。
 *
 * snippet 不够时深挖用。RSS 实现：content:encoded 字段（如有），否则 fallback。
 *
 * 铁律：
 * - 拿不到全文（fetcher 未实现 readFull 或调用失败）→ status:partial，
 *   summary 明确提示"原文摘要可用"，不当作 ok 静默处理。
 * - 源不存在 → status:not_found。
 */
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import { toolResult } from '../../agent/tools/tool-result';

export interface ReadItemFullDeps {
  infoSourceRepo: InfoSourceRepository;
  fetcherRegistry: FetcherRegistry;
}

export function createReadItemFullTool(deps: ReadItemFullDeps) {
  const { infoSourceRepo, fetcherRegistry } = deps;

  return tool({
    description:
      '拉取指定条目的全文内容（适合 snippet 不够时深挖），返回 detail 为全文（最多 3000 字）。' +
      '若该源不支持全文拉取，或拉取失败，返回 status:partial，原文摘要（snippet）仍可用，可继续用 snippet 撰写报告。' +
      '读完全文后可用 itemGuid 调 save_finding 把该条目保存到本期报告。',
    inputSchema: jsonSchema<{ sourceId: string; itemGuid: string }>({
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: '信息源 id，来自 list_sources 返回的 meta.sources[].id',
          examples: ['6830a1fc200000001'],
        },
        itemGuid: {
          type: 'string',
          description:
            '目标条目的 itemGuid，来自 fetch_source 或 search_source 返回的 meta.items[].itemGuid',
          examples: ['https://example.com/article-123', 'guid-abc-456'],
        },
      },
      examples: [
        {
          sourceId: '6830a1fc200000001',
          itemGuid: 'https://example.com/article-123',
        },
      ],
      required: ['sourceId', 'itemGuid'],
    }),
    execute: async ({
      sourceId,
      itemGuid,
    }: {
      sourceId: string;
      itemGuid: string;
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

        const fetcher = fetcherRegistry.get(source.type);

        // readFull 是可选能力 — 不实现则 partial 降级，原文摘要仍可用
        if (typeof fetcher.readFull !== 'function') {
          return toolResult(
            `「${source.name}」不支持全文拉取，原文摘要可用——可继续用 snippet 撰写报告`,
            undefined,
            {
              status: 'partial',
              fullContent: null,
              hint: 'full content not available, use snippet instead',
            },
          );
        }

        let fullContent: string;
        try {
          fullContent = await fetcher.readFull(source.config, itemGuid);
        } catch {
          // readFull 抛错（如找不到 content:encoded）→ 同样 partial 降级
          return toolResult(
            '全文拉取失败，原文摘要可用——可继续用 snippet 撰写报告',
            undefined,
            {
              status: 'partial',
              fullContent: null,
              hint: 'full content not available, use snippet instead',
            },
          );
        }

        return toolResult(
          `全文已获取 · ${fullContent.length} 字符`,
          fullContent.slice(0, 3000), // detail 给模型，截到合理长度
          { status: 'ok', charCount: fullContent.length },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`全文拉取失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
