import { tool, jsonSchema } from 'ai';
import { Logger } from '@nestjs/common';
import { toolResult } from './tool-result';
import { WebFetchError, type WebFetchProvider } from './web-fetch-provider';
import {
  ExternalCacheRepository,
  type ExternalCacheKey,
} from '../../external-cache/external-cache.repository';

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
const OK_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 10 * 60 * 1000;
const WEB_FETCH_ERROR_SUMMARY = '页面读取失败';
const logger = new Logger('WebFetchTool');

function buildWebFetchCacheKey(
  provider: WebFetchProvider,
  url: string,
  maxLength: number | undefined,
): ExternalCacheKey {
  return {
    namespace: 'web',
    operation: 'fetch',
    key: {
      url,
      maxLength: maxLength ?? null,
      provider: provider.cacheKey ?? provider.name,
    },
  };
}

export function createWebFetchTool(
  provider: WebFetchProvider,
  cacheRepo?: ExternalCacheRepository,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
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
        const normalizedUrl = url.trim();
        const cacheKey = buildWebFetchCacheKey(
          provider,
          normalizedUrl,
          maxLength,
        );
        const now = new Date();
        const cached = cacheRepo
          ? await cacheRepo.getFresh(cacheKey, now)
          : null;
        if (cached?.status === 'ok' && cached.payload) {
          const response = cached.payload as {
            markdown: string;
            truncated: boolean;
            provider: string;
            responseTimeSec?: number;
            attempts?: unknown[];
          };
          const truncatedNote = response.truncated
            ? ` · 截断显示前 ${response.markdown.length} 字符(若需要继续可用更大 maxLength 重读)`
            : '';
          return toolResult(
            `web_fetch · ${normalizedUrl} · ${response.markdown.length} 字符 · cache hit${truncatedNote}`,
            response.markdown,
            {
              status: 'ok',
              provider: response.provider,
              length: response.markdown.length,
              truncated: response.truncated,
              responseTimeSec: response.responseTimeSec,
              attempts: response.attempts,
              cached: true,
            },
          );
        }
        if (cached?.status === 'error' && cached.error) {
          const error = cached.error as {
            kind?: string;
          };
          const attempts = Array.isArray(cached.meta?.attempts)
            ? cached.meta.attempts
            : undefined;
          return toolResult(
            `web_fetch 失败(cache hit): ${WEB_FETCH_ERROR_SUMMARY}`,
            undefined,
            {
              status: 'error',
              kind: error.kind,
              attempts,
              cached: true,
            },
          );
        }

        const response = await provider.fetch(normalizedUrl, { maxLength });

        const truncatedNote = response.truncated
          ? ` · 截断显示前 ${response.markdown.length} 字符(若需要继续可用更大 maxLength 重读)`
          : '';
        const summary = `web_fetch · ${url} · ${response.markdown.length} 字符${truncatedNote}`;
        const detail = response.markdown;
        if (cacheRepo) {
          try {
            await cacheRepo.setOk(
              cacheKey,
              {
                url: response.url,
                markdown: response.markdown,
                truncated: response.truncated,
                provider: response.provider,
                responseTimeSec: response.responseTimeSec,
                attempts: response.attempts,
              },
              {
                provider: response.provider,
                attempts: response.attempts,
                length: response.markdown.length,
              },
              new Date(now.getTime() + OK_CACHE_TTL_MS),
              now,
            );
          } catch (cacheErr) {
            logger.warn(
              `web_fetch ok cache write failed provider=${response.provider} err=${
                cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
              }`,
            );
          }
        }

        return toolResult(summary, detail, {
          status: 'ok',
          provider: response.provider,
          length: response.markdown.length,
          truncated: response.truncated,
          responseTimeSec: response.responseTimeSec,
          attempts: response.attempts,
          cached: false,
        });
      } catch (err) {
        if (err instanceof WebFetchError) {
          // invalid_url → invalid;其它(network/timeout/404/403/429/未知)→ error
          const status = err.kind === 'invalid_url' ? 'invalid' : 'error';
          if (cacheRepo && status === 'error') {
            const now = new Date();
            try {
              await cacheRepo.setError(
                buildWebFetchCacheKey(provider, url.trim(), maxLength),
                {
                  kind: err.kind,
                  message: err.message,
                  retryable:
                    err.kind === 'network' ||
                    err.kind === 'timeout' ||
                    err.kind === 'rate_limited',
                },
                { attempts: err.attempts },
                new Date(now.getTime() + ERROR_CACHE_TTL_MS),
                now,
              );
            } catch (cacheErr) {
              logger.warn(
                `web_fetch error cache write failed kind=${err.kind} err=${
                  cacheErr instanceof Error
                    ? cacheErr.message
                    : String(cacheErr)
                }`,
              );
            }
          }
          const summary =
            status === 'invalid' ? err.message : WEB_FETCH_ERROR_SUMMARY;
          return toolResult(`web_fetch 失败: ${summary}`, undefined, {
            status,
            kind: err.kind,
            attempts: err.attempts,
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
