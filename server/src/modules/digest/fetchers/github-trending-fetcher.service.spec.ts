/**
 * GithubTrendingFetcher 单元测试
 * - mock 全局 fetch（返回 HTML 字符串）
 * - Case 1: 正常 HTML → 解析出 owner/repo 和 description
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: keywords 本地过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { GithubTrendingFetcher } from './github-trending-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(
  config: Record<string, unknown> = { language: 'typescript' },
): InfoSource {
  return {
    _id: 'src_gh_trending',
    type: InfoSourceType.webpage,
    fetcherKind: FetcherKind.github_trending,
    name: 'GitHub Trending TS',
    config,
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

// 模拟 GitHub Trending 页面中两个 repo 的 HTML 片段
const SAMPLE_HTML = `
<html><body>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/twentyhq/twenty" >
      twentyhq / twenty
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">
    Twenty - A modern alternative to Salesforce, powered by React, NestJS
  </p>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/microsoft/TypeScript" >
      microsoft / TypeScript
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 pr-4">
    TypeScript is a superset of JavaScript that compiles to clean JavaScript output.
  </p>
</article>
</body></html>
`;

function mockOkText(text: string): unknown {
  return { ok: true, text: jest.fn().mockResolvedValue(text) };
}

describe('GithubTrendingFetcher', () => {
  let fetcher: GithubTrendingFetcher;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GithubTrendingFetcher],
    }).compile();
    fetcher = module.get(GithubTrendingFetcher);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.github_trending);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常 HTML 解析
  it('正常 HTML → 解析出 repo 条目（owner/repo + description）', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkText(SAMPLE_HTML));

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items.length).toBeGreaterThanOrEqual(2);
    const twenty = items.find((i) => i.itemGuid === 'gh_twentyhq_twenty');
    expect(twenty).toBeDefined();
    expect(twenty!.title).toBe('twentyhq/twenty');
    expect(twenty!.url).toBe('https://github.com/twentyhq/twenty');
    expect(twenty!.snippet).toContain('Salesforce');
    expect(twenty!.publishedAt).toBeUndefined();
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 github_trending 前缀', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /github_trending: fetch failed/,
    );
  });

  // Case 3: keywords 过滤
  it('keywords 过滤：只返回 title 或 snippet 含 keyword 的条目', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkText(SAMPLE_HTML));

    const items = await fetcher.fetch(makeSource(), {
      keywords: ['Salesforce'],
    });

    expect(items).toHaveLength(1);
    expect(items[0].itemGuid).toBe('gh_twentyhq_twenty');
  });
});
