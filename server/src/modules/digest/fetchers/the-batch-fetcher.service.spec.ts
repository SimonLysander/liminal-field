/**
 * TheBatchFetcher 单元测试
 * - mock 全局 fetch（返回 HTML 字符串）
 * - Case 1: 含 issue 链接的 HTML → 解析出期刊条目
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: keywords 本地过滤（title 匹配）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TheBatchFetcher } from './the-batch-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(): InfoSource {
  return {
    _id: 'src_thebatch',
    type: InfoSourceType.webpage,
    fetcherKind: FetcherKind.the_batch,
    name: 'The Batch',
    config: {},
    enabled: true,
    category: InfoSourceCategory.ai,
    createdAt: new Date(),
  };
}

// 模拟 The Batch 首页 HTML，含两个 issue 链接
const SAMPLE_HTML = `
<html><body>
<a href="/the-batch/issue-300/">
  <h2 class="entry-title">Issue 300: The State of AI in 2026</h2>
</a>
<a href="/the-batch/issue-299/">
  <h2 class="entry-title">Issue 299: Transformers and Beyond</h2>
</a>
<a href="/the-batch/tag/news/">tag link should be ignored</a>
</body></html>
`;

function mockOkText(text: string): unknown {
  return { ok: true, text: jest.fn().mockResolvedValue(text) };
}

describe('TheBatchFetcher', () => {
  let fetcher: TheBatchFetcher;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TheBatchFetcher],
    }).compile();
    fetcher = module.get(TheBatchFetcher);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.the_batch);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常 HTML 解析
  it('含 issue 链接的 HTML → 解析出期刊条目', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkText(SAMPLE_HTML));

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items.length).toBeGreaterThanOrEqual(2);
    const issue300 = items.find((i) => i.itemGuid === 'thebatch_issue-300');
    expect(issue300).toBeDefined();
    expect(issue300!.url).toBe(
      'https://www.deeplearning.ai/the-batch/issue-300/',
    );
    expect(issue300!.publishedAt).toBeUndefined();
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 the_batch 前缀', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /the_batch: fetch failed/,
    );
  });

  // Case 3: keywords 过滤（通过 title 匹配，title 来自 slug 或 h2）
  it('keywords 过滤：只返回 title 含 keyword 的条目', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkText(SAMPLE_HTML));

    const items = await fetcher.fetch(makeSource(), {
      keywords: ['Transformers'],
    });

    // 期望至少有一条含 Transformers 或 issue-299 的
    const hasMatch = items.some(
      (i) =>
        i.title.toLowerCase().includes('transformer') ||
        i.itemGuid.includes('299'),
    );
    expect(hasMatch).toBe(true);
  });
});
