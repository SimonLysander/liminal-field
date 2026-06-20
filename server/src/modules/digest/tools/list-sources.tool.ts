/**
 * list_sources — 列出事项订阅的所有信息源。
 *
 * LLM 通过此工具了解"这个事项挂了哪些源、每个源能做什么"，
 * 再决定对哪些源调 fetch / search。
 *
 * meta.list 给前端 NestedList 渲染（名称 · 类型 · 能力），
 * meta.sources 给模型做后续 sourceId 参数引用。
 */
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { InfoSource } from '../info-source.entity';
import { toolResult } from '../../agent/tools/tool-result';

function buildDescription(source: InfoSource): string {
  const urlHint = (source.config?.url as string | undefined) ?? '';
  return urlHint
    ? `${source.type} 源 · ${source.name} · ${urlHint}`
    : `${source.type} 源 · ${source.name}`;
}

export interface ListSourcesDeps {
  infoSourceRepo: InfoSourceRepository;
  stcRepo: SmartTopicConfigRepository;
}

export function createListSourcesTool(deps: ListSourcesDeps) {
  const { infoSourceRepo, stcRepo } = deps;

  return tool({
    description:
      '列出指定采集事项订阅的所有信息源（名称、类型、能力清单），用于了解本事项有哪些可用信息源。' +
      '返回 meta.sources 含每个源的 id、name、type、capabilities；' +
      '拿到 sourceId 后用 fetch_source 拉最新条目，或用 search_source 按关键词搜索。',
    inputSchema: jsonSchema<{ topicId: string }>({
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: '采集事项的 contentItemId（ci_xxx 格式），来自事项列表',
          examples: ['ci_26869a17d3fc', 'ci_9b3f2ae100cc'],
        },
      },
      examples: [{ topicId: 'ci_26869a17d3fc' }],
      required: ['topicId'],
    }),
    execute: async ({ topicId }: { topicId: string }) => {
      try {
        // 按 contentItemId 拿事项配置，取其 sourceIds
        const config = await stcRepo.findByContentItemId(topicId);
        if (!config) {
          return toolResult('事项不存在或未配置，无法列出信息源', undefined, {
            status: 'not_found',
            topicId,
          });
        }

        const sources = await infoSourceRepo.findManyByIds(config.sourceIds);

        if (sources.length === 0) {
          return toolResult('该事项暂未订阅任何信息源', undefined, {
            status: 'ok',
            total: 0,
            list: [],
          });
        }

        const items = sources.map((s) => ({
          id: String(s._id),
          name: s.name,
          type: s.type,
          description: buildDescription(s),
          // RSS 三种能力都支持；未来按 fetcher.caps 动态生成
          capabilities: ['fetch', 'search', 'read_full'] as string[],
        }));

        const detail = items
          .map(
            (s) =>
              `[${s.type}] ${s.name} (${s.id})\n  ${s.description}\n  capabilities: ${s.capabilities.join(', ')}`,
          )
          .join('\n\n');

        // list 给前端 NestedList 渲染（名称 · 类型 · 能力），不露数据库 ID
        const list = items.map(
          (s) => `${s.name} · ${s.type} · [${s.capabilities.join(', ')}]`,
        );

        return toolResult(`共 ${items.length} 个信息源`, detail, {
          status: 'ok',
          total: items.length,
          list,
          sources: items,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`列出信息源失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
