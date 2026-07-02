/* eslint-disable @typescript-eslint/require-await -- 测试 stub 用 async fn 抛错是常见 pattern */
import { createWebFetchTool } from '../web-fetch.tool';
import {
  WebFetchError,
  type WebFetchProvider,
  type WebFetchResponse,
  type WebFetchOptions,
} from '../web-fetch-provider';
import type { ExternalCacheRepository } from '../../../external-cache/external-cache.repository';

const RUN = {} as never;
type Parsed = {
  summary: string;
  detail?: string;
  meta?: Record<string, unknown>;
};
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;
const run = (tool: unknown, input: unknown) =>
  (
    tool as { execute: (i: unknown, o: unknown) => Promise<string> | string }
  ).execute(input, RUN);

function stubProvider(
  impl: (url: string, opts: WebFetchOptions) => Promise<WebFetchResponse>,
  name = 'stub',
): WebFetchProvider {
  return { name, fetch: jest.fn(impl) };
}

function stubCache(
  overrides?: Partial<
    Pick<ExternalCacheRepository, 'getFresh' | 'setOk' | 'setError'>
  >,
): jest.Mocked<
  Pick<ExternalCacheRepository, 'getFresh' | 'setOk' | 'setError'>
> {
  return {
    getFresh: jest.fn().mockResolvedValue(null),
    setOk: jest.fn().mockResolvedValue(undefined),
    setError: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<
    Pick<ExternalCacheRepository, 'getFresh' | 'setOk' | 'setError'>
  >;
}

const okResponse = (
  overrides?: Partial<WebFetchResponse>,
): WebFetchResponse => ({
  url: 'https://example.com/a',
  markdown: '# Hello\n\nbody.',
  truncated: false,
  provider: 'stub',
  ...overrides,
});

describe('web_fetch tool', () => {
  it('正常调用:status=ok + detail = markdown + meta.length 准确', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(
      await run(createWebFetchTool(provider), {
        url: 'https://example.com/a',
      }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.detail).toBe('# Hello\n\nbody.');
    expect(r.meta?.length).toBe('# Hello\n\nbody.'.length);
    expect(r.meta?.provider).toBe('stub');
    expect(r.meta?.truncated).toBe(false);
    expect(r.summary).toContain('web_fetch');
    expect(r.summary).toContain('https://example.com/a');
  });

  it('truncated 时 summary 含"截断显示"提示 + meta.truncated=true', async () => {
    const provider = stubProvider(async () =>
      okResponse({ markdown: 'x'.repeat(100), truncated: true }),
    );
    const r = parse(
      await run(createWebFetchTool(provider), {
        url: 'https://example.com/long',
        maxLength: 100,
      }),
    );
    expect(r.meta?.truncated).toBe(true);
    expect(r.summary).toContain('截断显示');
  });

  it('maxLength 透传给 provider', async () => {
    let capturedOpts: WebFetchOptions = {};
    const provider = stubProvider(async (_u, opts) => {
      capturedOpts = opts;
      return okResponse();
    });
    await run(createWebFetchTool(provider), {
      url: 'https://example.com/a',
      maxLength: 5000,
    });
    expect(capturedOpts.maxLength).toBe(5000);
  });

  it('url 空 → status=invalid', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(await run(createWebFetchTool(provider), { url: '   ' }));
    expect(r.meta?.status).toBe('invalid');
  });

  it('url 过长 → status=invalid', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(
      await run(createWebFetchTool(provider), {
        url: 'https://x.com/' + 'a'.repeat(2000),
      }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('provider 抛 invalid_url → status=invalid + kind=invalid_url', async () => {
    const provider = stubProvider(async () => {
      throw new WebFetchError('invalid_url', '非法 URL');
    });
    const r = parse(
      await run(createWebFetchTool(provider), { url: 'ftp://bad' }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.meta?.kind).toBe('invalid_url');
  });

  it('provider 抛 not_found → status=error + kind=not_found', async () => {
    const provider = stubProvider(async () => {
      throw new WebFetchError('not_found', '404');
    });
    const r = parse(
      await run(createWebFetchTool(provider), { url: 'https://x.com/y' }),
    );
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('not_found');
  });

  it('provider 链路全部失败时 summary 不暴露内部 attempts 拼接', async () => {
    const attempts = [
      {
        provider: 'direct',
        status: 'error' as const,
        kind: 'network' as const,
      },
      {
        provider: 'jina-reader',
        status: 'error' as const,
        kind: 'network' as const,
      },
    ];
    const provider = stubProvider(async () => {
      throw new WebFetchError(
        'network',
        '所有 web_fetch provider 均失败: direct:network, jina-reader:network',
        undefined,
        attempts,
      );
    });

    const r = parse(
      await run(createWebFetchTool(provider), { url: 'https://x.com/y' }),
    );

    expect(r.summary).toBe('web_fetch 失败: 页面读取失败');
    expect(r.summary).not.toContain('provider');
    expect(r.summary).not.toContain('direct:network');
    expect(r.meta?.message).toBeUndefined();
    expect(r.meta?.attempts).toEqual(attempts);
  });

  it('provider 抛 rate_limited → status=error + kind=rate_limited', async () => {
    const provider = stubProvider(async () => {
      throw new WebFetchError('rate_limited', '429');
    });
    const r = parse(
      await run(createWebFetchTool(provider), { url: 'https://x.com/y' }),
    );
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('rate_limited');
  });

  it('provider 抛 timeout → status=error + kind=timeout', async () => {
    const provider = stubProvider(async () => {
      throw new WebFetchError('timeout', 'aborted');
    });
    const r = parse(
      await run(createWebFetchTool(provider), { url: 'https://x.com/y' }),
    );
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('timeout');
  });

  it('provider 抛任意 Error → status=error + kind=unknown', async () => {
    const provider = stubProvider(async () => {
      throw new Error('whoops');
    });
    const r = parse(
      await run(createWebFetchTool(provider), { url: 'https://x.com/y' }),
    );
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('unknown');
  });

  it('缓存命中 ok → 不调用 provider,返回 cached=true', async () => {
    const provider = stubProvider(async () => okResponse());
    const cache = stubCache({
      getFresh: jest.fn().mockResolvedValue({
        status: 'ok',
        payload: okResponse({ markdown: 'cached body', provider: 'direct' }),
        meta: { provider: 'direct' },
      }),
    });

    const r = parse(
      await run(createWebFetchTool(provider, cache as never), {
        url: 'https://example.com/a',
      }),
    );

    expect(r.detail).toBe('cached body');
    expect(r.meta?.cached).toBe(true);
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('缓存命中 error → 不调用 provider,返回 cached=true', async () => {
    const provider = stubProvider(async () => okResponse());
    const cache = stubCache({
      getFresh: jest.fn().mockResolvedValue({
        status: 'error',
        error: { kind: 'network', message: 'cached network error' },
        meta: {
          attempts: [
            {
              provider: 'direct',
              status: 'error',
              kind: 'network',
              message: 'x',
            },
          ],
        },
      }),
    });

    const r = parse(
      await run(createWebFetchTool(provider, cache as never), {
        url: 'https://example.com/a',
      }),
    );

    expect(r.meta?.status).toBe('error');
    expect(r.meta?.cached).toBe(true);
    expect(r.meta?.kind).toBe('network');
    expect(r.summary).toBe('web_fetch 失败(cache hit): 页面读取失败');
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('成功抓取后写入通用 external cache', async () => {
    const provider = stubProvider(async () =>
      okResponse({ provider: 'direct' }),
    );
    const cache = stubCache();

    await run(createWebFetchTool(provider, cache as never), {
      url: 'https://example.com/a',
      maxLength: 5000,
    });

    expect(cache.setOk).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'web',
        operation: 'fetch',
        key: {
          url: 'https://example.com/a',
          maxLength: 5000,
          provider: 'stub',
        },
      }),
      expect.objectContaining({ markdown: '# Hello\n\nbody.' }),
      expect.objectContaining({ provider: 'direct' }),
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('成功抓取后 cache 写入失败仍返回正文', async () => {
    const provider = stubProvider(async () =>
      okResponse({ markdown: 'fresh body', provider: 'direct' }),
    );
    const cache = stubCache({
      setOk: jest.fn().mockRejectedValue(new Error('mongo down')),
    });

    const r = parse(
      await run(createWebFetchTool(provider, cache as never), {
        url: 'https://example.com/a',
      }),
    );

    expect(r.meta?.status).toBe('ok');
    expect(r.detail).toBe('fresh body');
    expect(r.meta?.cached).toBe(false);
  });

  it('provider 失败后 cache 写入失败仍返回原始错误 kind', async () => {
    const provider = stubProvider(async () => {
      throw new WebFetchError('timeout', 'origin timeout');
    });
    const cache = stubCache({
      setError: jest.fn().mockRejectedValue(new Error('mongo down')),
    });

    const r = parse(
      await run(createWebFetchTool(provider, cache as never), {
        url: 'https://example.com/a',
      }),
    );

    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('timeout');
    expect(r.summary).toBe('web_fetch 失败: 页面读取失败');
  });

  it('cache key 优先使用 provider.cacheKey 以区分 auto 链路版本', async () => {
    const provider = {
      ...stubProvider(
        async () => okResponse({ provider: 'firecrawl' }),
        'auto',
      ),
      cacheKey: 'auto:direct-firecrawl-jina:v1',
    };
    const cache = stubCache();

    await run(createWebFetchTool(provider, cache as never), {
      url: 'https://example.com/a',
    });

    expect(cache.setOk).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({
          provider: 'auto:direct-firecrawl-jina:v1',
        }),
      }),
      expect.anything(),
      expect.anything(),
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('provider WebFetchError → 写入短期 error cache 且 meta 带 attempts', async () => {
    const err = new WebFetchError('network', 'direct failed', undefined, [
      { provider: 'direct', status: 'error', kind: 'network', message: 'x' },
    ]);
    const provider = stubProvider(async () => {
      throw err;
    });
    const cache = stubCache();

    const r = parse(
      await run(createWebFetchTool(provider, cache as never), {
        url: 'https://example.com/a',
      }),
    );

    expect(r.meta?.status).toBe('error');
    expect(r.meta?.attempts).toEqual(err.attempts);
    expect(cache.setError).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'web',
        operation: 'fetch',
      }),
      expect.objectContaining({ kind: 'network', message: 'direct failed' }),
      expect.objectContaining({ attempts: err.attempts }),
      expect.any(Date),
      expect.any(Date),
    );
  });
});
