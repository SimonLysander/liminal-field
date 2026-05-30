import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import { WebSearchError, type WebSearchProvider } from './web-search-provider';

/**
 * web_search — Aurora 联网搜索工具(provider-agnostic)。
 *
 * 何时调:模型需要验证事实/查引用/找外部信息时(用户问外部知识、写作要找资料、
 * 验年代/人名/书名等)。**仅在用户明确问外部信息或写作需要时调**,避免无端浪费。
 *
 * 走 provider 抽象:首发 Tavily,可切 Serper.dev / SerpAPI 等。provider 实例
 * 在 tool.assembler 装配时由 createWebSearchProviderFromEnv 构造,没配 key 时
 * 装配层不挂本工具(模型看不到 → 不会调)。
 */

const MAX_QUERY_LENGTH = 400;

export function createWebSearchTool(provider: WebSearchProvider) {
  return tool({
    description:
      '联网搜索。需要验证事实/查引用/找外部信息时调用(用户问外部知识、写作要找资料、验年代/人名/书名等)。返回多条 url + 摘要片段,可直接在回答中引用 url。不要为闲聊瞎调——只在写作或回答真需要外部依据时用。',
    inputSchema: jsonSchema<{
      query: string;
      maxResults?: number;
      topic?: 'general' | 'news';
    }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索 query。简洁、关键词为主,不必造完整句子。',
        },
        maxResults: {
          type: 'number',
          description: '本次最多返回多少条结果,1-10,默认 5',
        },
        topic: {
          type: 'string',
          enum: ['general', 'news'],
          description: 'general 通用搜索;news 偏新闻类。默认 general',
        },
      },
      required: ['query'],
    }),
    execute: async ({
      query,
      maxResults = 5,
      topic = 'general',
    }: {
      query: string;
      maxResults?: number;
      topic?: 'general' | 'news';
    }) => {
      if (typeof query !== 'string' || query.trim().length === 0) {
        return toolResult('query 不能为空', undefined, { status: 'invalid' });
      }
      if (query.length > MAX_QUERY_LENGTH) {
        return toolResult(
          `query 过长(>${MAX_QUERY_LENGTH} 字符),请精简关键词`,
          undefined,
          { status: 'invalid' },
        );
      }

      try {
        const response = await provider.search(query.trim(), {
          maxResults,
          topic,
        });

        // summary:行内"工具 · 参数 · 统计"——前端展示给用户看的一行
        const summary = `web_search · ${query} · ${response.results.length} 条结果(${response.provider})`;

        // detail:给模型读的主体内容。answer + 编号列表(url + 摘要)
        // 编号方便模型在回复里用 [1][2] 引用
        const detailParts: string[] = [];
        if (response.answer) {
          detailParts.push(`概要:${response.answer}\n`);
        }
        if (response.results.length === 0) {
          detailParts.push('没有找到相关结果。');
        } else {
          response.results.forEach((r, i) => {
            const scoreStr =
              r.score !== undefined ? ` · score=${r.score.toFixed(2)}` : '';
            detailParts.push(
              `[${i + 1}] ${r.title}${scoreStr}\n${r.url}\n${r.content}`,
            );
          });
        }
        const detail = detailParts.join('\n\n');

        return toolResult(summary, detail, {
          status: 'ok',
          provider: response.provider,
          resultCount: response.results.length,
          responseTimeSec: response.responseTimeSec,
        });
      } catch (err) {
        if (err instanceof WebSearchError) {
          // missing_key / bad_request → invalid(用户/配置层错误);
          // network / timeout / rate_limited / unknown → error(第三方故障)
          const status =
            err.kind === 'missing_key' || err.kind === 'bad_request'
              ? 'invalid'
              : 'error';
          return toolResult(`web_search 失败: ${err.message}`, undefined, {
            status,
            kind: err.kind,
          });
        }
        return toolResult(
          `web_search 未知错误: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          { status: 'error', kind: 'unknown' },
        );
      }
    },
  });
}
