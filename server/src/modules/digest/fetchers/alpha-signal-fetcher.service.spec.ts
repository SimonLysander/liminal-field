/**
 * AlphaSignalFetcher 单元测试
 * - mock ./http.utils（httpGetText）
 * - Case 1: 正常 sitemap XML → 解析出 /news/ 条目
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: since 过滤（按 lastmod）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AlphaSignalFetcher } from './alpha-signal-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

jest.mock('./http.utils', () => ({
  httpGetJson: jest.fn(),
  httpGetText: jest.fn(),
  httpPostJson: jest.fn(),
  httpFetch: jest.fn(),
}));

import { httpGetText } from './http.utils';
const mockHttpGetText = httpGetText as jest.MockedFunction<typeof httpGetText>;

function makeSource(): InfoSource {
  return {
    _id: 'src_alphasignal',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.alpha_signal,
    name: 'AlphaSignal',
    config: {},
    enabled: true,
    category: InfoSourceCategory.ai,
    createdAt: new Date(),
  };
}

const SAMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://alphasignal.ai/news/anthropic-s-claude-launched</loc>
    <lastmod>2026-06-21T10:22:04.054Z</lastmod>
  </url>
  <url>
    <loc>https://alphasignal.ai/news/openai-releases-gpt-5</loc>
    <lastmod>2026-06-20T08:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://alphasignal.ai/</loc>
    <lastmod>2026-06-21T00:00:00.000Z</lastmod>
  </url>
</urlset>`;

describe('AlphaSignalFetcher', () => {
  let fetcher: AlphaSignalFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlphaSignalFetcher],
    }).compile();
    fetcher = module.get(AlphaSignalFetcher);
    jest.clearAllMocks();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.alpha_signal);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 sitemap XML → 解析出 /news/ 条目，title = slug 转可读', async () => {
    mockHttpGetText.mockResolvedValueOnce(SAMPLE_SITEMAP);

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    // 只应该有 2 条 /news/ 的（首页 / 被过滤）
    expect(items).toHaveLength(2);
    // 按 lastmod 倒序，最新在前
    expect(items[0].url).toBe(
      'https://alphasignal.ai/news/anthropic-s-claude-launched',
    );
    expect(items[0].itemGuid).toBe(
      'https://alphasignal.ai/news/anthropic-s-claude-launched',
    );
    expect(items[0].title).toBe('anthropic s claude launched'); // slug → readable
    expect(items[0].publishedAt).toEqual(new Date('2026-06-21T10:22:04.054Z'));
    expect(items[0].snippet).toBe('');
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 alpha_signal 前缀', async () => {
    mockHttpGetText.mockRejectedValueOnce(
      new Error('HTTP 404 Not Found url=https://alphasignal.ai/sitemap.xml'),
    );

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /alpha_signal: fetch failed/,
    );
  });

  // Case 3: since 过滤
  it('since 过滤：只返回 lastmod > since 的条目', async () => {
    mockHttpGetText.mockResolvedValueOnce(SAMPLE_SITEMAP);

    const since = new Date('2026-06-21T00:00:00Z');
    const items = await fetcher.fetch(makeSource(), { since });

    // 只有 2026-06-21T10:22:04Z 的那条通过
    expect(items).toHaveLength(1);
    expect(items[0].url).toContain('anthropic');
  });
});
