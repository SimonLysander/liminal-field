import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import { WebFetchError, type WebFetchProvider } from './web-fetch-provider';

/**
 * web_fetch — 给定 URL 读全文(markdown 形式)。
 *
 * 与 web_search 互补:
 *   - web_search:给关键词拿一堆 url + 摘要片段(浅)
 *   - web_fetch:给 url 拿单页全文(深读)
 *
 * 何时调:
 *   - 用户直接贴 URL 让你读
 *   - web_search 找到一个 url 后,摘要片段不够,需要深读全文
 *   - 写作需要引用某篇博客/论文/新闻的完整观点
 *
 * 不要为闲聊瞎调。一次 fetch 默认截断 30k 字符,长文模型可在 maxLength 调节。
 */

const MAX_URL_LENGTH = 2000;

export function createWebFetchTool(provider: WebFetchProvider) {
  return tool({
    description:
      '读取一个 URL 的全文(markdown 形式)。用于深读外部文章——用户贴 url、或 web_search 后想读全文。返回页面正文(自动去广告/导航)。**不要为闲聊瞎调**,只在写作或回答真需要深读外部页面时用。长文会被截断(默认 30000 字符)。',
    inputSchema: jsonSchema<{ url: string; maxLength?: number }>({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '完整 http(s) URL,要读的页面',
        },
        maxLength: {
          type: 'number',
          description: '本次最多返回多少字符,默认 30000(范围 500-100000)',
        },
      },
      required: ['url'],
    }),
    execute: async ({
      url,
      maxLength,
    }: {
      url: string;
      maxLength?: number;
    }) => {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return toolResult('url 不能为空', undefined, { status: 'invalid' });
      }
      if (url.length > MAX_URL_LENGTH) {
        return toolResult(`url 过长(>${MAX_URL_LENGTH} 字符)`, undefined, {
          status: 'invalid',
        });
      }

      try {
        const response = await provider.fetch(url.trim(), { maxLength });

        const truncatedNote = response.truncated
          ? ` · 截断显示前 ${response.markdown.length} 字符(若需要继续可用更大 maxLength 重读)`
          : '';
        const summary = `web_fetch · ${url} · ${response.markdown.length} 字符${truncatedNote}`;
        const detail = response.markdown;

        return toolResult(summary, detail, {
          status: 'ok',
          provider: response.provider,
          length: response.markdown.length,
          truncated: response.truncated,
          responseTimeSec: response.responseTimeSec,
        });
      } catch (err) {
        if (err instanceof WebFetchError) {
          // invalid_url → invalid;其它(network/timeout/404/403/429/未知)→ error
          const status = err.kind === 'invalid_url' ? 'invalid' : 'error';
          return toolResult(`web_fetch 失败: ${err.message}`, undefined, {
            status,
            kind: err.kind,
          });
        }
        return toolResult(
          `web_fetch 未知错误: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          { status: 'error', kind: 'unknown' },
        );
      }
    },
  });
}
