/* eslint-disable @typescript-eslint/require-await -- 测试 stub 用 async fn 抛错是常见 pattern */
import { createWebFetchTool } from '../web-fetch.tool';
import {
  WebFetchError,
  type WebFetchProvider,
  type WebFetchResponse,
  type WebFetchOptions,
} from '../web-fetch-provider';

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
  return { name, fetch: impl };
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
});
