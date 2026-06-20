/**
 * view — v3：拉某条 item 的全文，输入为 browse/search 返回的 item ref（i1, i2...）。
 *
 * 设计决策：
 * - 参数只有 ref（而非 sourceId + itemGuid）：LLM 用 browse/search 拿到的 ref 就够，
 *   系统从 fetchedItemsMap 反查完整 item（含 sourceRef → infoSource）。
 * - 不支持全文的 fetcher → status:partial，返回 snippet 降级，不算 error。
 * - 5000 字符截断并标记 truncated:true，让 LLM 知道正文可能不全。
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { TaskContext } from './digest-tools.factory';
import { toolResult } from '../../agent/tools/tool-result';

const logger = new Logger('view');
const MAX_CHARS = 5000;

export interface ViewDeps {
  fetcherRegistry: FetcherRegistry;
  ctx: TaskContext;
}

export function createViewTool(deps: ViewDeps) {
  const { fetcherRegistry, ctx } = deps;

  return tool({
    description:
      '拉某条 item 的全文（snippet 不够判断时用）。返回 detail 含完整正文（≤ 5000 字符）。' +
      "如果源不支持取全文，status='partial' 返回 snippet 即可。",
    inputSchema: jsonSchema<{ ref: string }>({
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: '从 browse/search 返回的 ref',
          examples: ['i3', 'i12'],
        },
      },
      examples: [{ ref: 'i3' }],
      required: ['ref'],
    }),
    execute: async ({ ref }: { ref: string }) => {
      try {
        const entry = ctx.fetchedItemsMap.get(ref);
        if (!entry) {
          return toolResult(
            `item ref "${ref}" 不存在，请先调 browse 或 search`,
            undefined,
            { status: 'error', errorCode: 'ITEM_NOT_FOUND', ref },
          );
        }

        const { fetchedItem, sourceRef, sourceName } = entry;
        const infoSource = ctx.sourceRefsMap.get(sourceRef);

        if (!infoSource) {
          // sourceRefsMap 里没有 → fallback 到 snippet
          return toolResult(
            `全文 ${fetchedItem.snippet.length} 字（降级 snippet）`,
            fetchedItem.snippet,
            {
              status: 'partial',
              title: fetchedItem.title,
              sourceName,
              url: fetchedItem.url,
              publishedAt: fetchedItem.publishedAt?.toISOString(),
              chars: fetchedItem.snippet.length,
              truncated: false,
            },
          );
        }

        const fetcher = fetcherRegistry.get(infoSource.type);

        if (typeof fetcher.readFull !== 'function') {
          return toolResult(
            `全文 ${fetchedItem.snippet.length} 字（该源不支持全文，返回 snippet）`,
            fetchedItem.snippet,
            {
              status: 'partial',
              title: fetchedItem.title,
              sourceName,
              url: fetchedItem.url,
              publishedAt: fetchedItem.publishedAt?.toISOString(),
              chars: fetchedItem.snippet.length,
              truncated: false,
            },
          );
        }

        let fullContent: string;
        try {
          fullContent = await fetcher.readFull(
            infoSource.config,
            fetchedItem.itemGuid,
          );
        } catch (readErr) {
          logger.warn(
            `view readFull 失败: ref=${ref} source=${sourceName} err=${readErr instanceof Error ? readErr.message : String(readErr)}`,
          );
          return toolResult(
            `全文 ${fetchedItem.snippet.length} 字（全文读取失败，返回 snippet）`,
            fetchedItem.snippet,
            {
              status: 'partial',
              title: fetchedItem.title,
              sourceName,
              url: fetchedItem.url,
              publishedAt: fetchedItem.publishedAt?.toISOString(),
              chars: fetchedItem.snippet.length,
              truncated: false,
            },
          );
        }

        const truncated = fullContent.length > MAX_CHARS;
        const body = truncated ? fullContent.slice(0, MAX_CHARS) : fullContent;
        const chars = body.length;

        logger.debug(`view: ref=${ref} chars=${chars} truncated=${truncated}`);

        return toolResult(`全文 ${chars} 字`, body, {
          status: 'ok',
          title: fetchedItem.title,
          sourceName,
          url: fetchedItem.url,
          publishedAt: fetchedItem.publishedAt?.toISOString(),
          chars,
          truncated,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`view 失败: ${msg}`, undefined, { status: 'error' });
      }
    },
  });
}
