/* eslint-disable @typescript-eslint/require-await -- 测试 stub 用 async fn 抛错是常见 pattern */
import { createWebSearchTool } from '../web-search.tool';
import {
  WebSearchError,
  type WebSearchProvider,
  type WebSearchResponse,
  type WebSearchOptions,
} from '../web-search-provider';

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

/** 测试用 stub provider:可配置返回值或抛错 */
function stubProvider(
  impl: (q: string, opts: WebSearchOptions) => Promise<WebSearchResponse>,
  name = 'stub',
): WebSearchProvider {
  return { name, search: impl };
}

const okResponse = (
  overrides?: Partial<WebSearchResponse>,
): WebSearchResponse => ({
  query: 'test',
  results: [
    {
      title: 'Result A',
      url: 'https://a.com',
      content: 'snippet a',
      score: 0.9,
    },
    {
      title: 'Result B',
      url: 'https://b.com',
      content: 'snippet b',
      score: 0.7,
    },
  ],
  provider: 'stub',
  ...overrides,
});

describe('web_search tool', () => {
  it('正常调用:status=ok + summary 含 provider + detail 编号列表', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(
      await run(createWebSearchTool(provider), { query: '独处' }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.provider).toBe('stub');
    expect(r.meta?.resultCount).toBe(2);
    expect(r.summary).toContain('web_search');
    expect(r.summary).toContain('独处');
    expect(r.summary).toContain('stub');
    // 编号列表给模型 [1] [2] 引用
    expect(r.detail).toContain('[1] Result A');
    expect(r.detail).toContain('[2] Result B');
    expect(r.detail).toContain('https://a.com');
  });

  it('有 answer 时 detail 顶部含"概要:"', async () => {
    const provider = stubProvider(async () =>
      okResponse({ answer: '简要总结。' }),
    );
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.detail).toContain('概要:简要总结。');
  });

  it('0 结果时 detail 提示"没有找到"', async () => {
    const provider = stubProvider(async () => okResponse({ results: [] }));
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.resultCount).toBe(0);
    expect(r.detail).toContain('没有找到');
  });

  it('query 空 → status=invalid', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(await run(createWebSearchTool(provider), { query: '   ' }));
    expect(r.meta?.status).toBe('invalid');
  });

  it('query 过长(>400 字符)→ status=invalid', async () => {
    const provider = stubProvider(async () => okResponse());
    const r = parse(
      await run(createWebSearchTool(provider), { query: 'a'.repeat(401) }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('maxResults/topic 透传给 provider', async () => {
    let capturedOpts: WebSearchOptions = {};
    const provider = stubProvider(async (_q, opts) => {
      capturedOpts = opts;
      return okResponse();
    });
    await run(createWebSearchTool(provider), {
      query: 'x',
      maxResults: 3,
      topic: 'news',
    });
    expect(capturedOpts.maxResults).toBe(3);
    expect(capturedOpts.topic).toBe('news');
  });

  it('provider 抛 missing_key → status=invalid + kind=missing_key', async () => {
    const provider = stubProvider(async () => {
      throw new WebSearchError('missing_key', 'TAVILY_API_KEY 未配置');
    });
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.meta?.status).toBe('invalid');
    expect(r.meta?.kind).toBe('missing_key');
  });

  it('provider 抛 network → status=error + kind=network', async () => {
    const provider = stubProvider(async () => {
      throw new WebSearchError('network', 'ECONNREFUSED');
    });
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('network');
  });

  it('provider 抛 rate_limited → status=error + kind=rate_limited', async () => {
    const provider = stubProvider(async () => {
      throw new WebSearchError('rate_limited', '超限');
    });
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('rate_limited');
  });

  it('provider 抛任意 Error → status=error + kind=unknown', async () => {
    const provider = stubProvider(async () => {
      throw new Error('whoops');
    });
    const r = parse(await run(createWebSearchTool(provider), { query: 'x' }));
    expect(r.meta?.status).toBe('error');
    expect(r.meta?.kind).toBe('unknown');
  });
});
