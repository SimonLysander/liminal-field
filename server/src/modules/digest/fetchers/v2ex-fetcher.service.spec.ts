/**
 * V2exFetcher 单元测试
 * - mock 全局 fetch
 * - Case 1: 正常 JSON 解析 → FetchedItem[]
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: keywords 本地过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { V2exFetcher } from './v2ex-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(): InfoSource {
  return {
    _id: 'src_v2ex',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.v2ex,
    name: 'V2EX',
    config: {},
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

const SAMPLE_DATA = [
  {
    id: 1098765,
    title: '用 Bun 跑 NestJS 体验如何',
    url: 'https://www.v2ex.com/t/1098765',
    content: '最近想试试用 Bun 作为运行时...',
    content_rendered: '<p>最近想试试...</p>',
    created: 1750464000, // 2025-06-21T00:00:00Z
    node: { name: 'node-js', title: 'Node.js' },
  },
  {
    id: 1098764,
    title: 'TypeScript 5.8 新特性',
    url: 'https://www.v2ex.com/t/1098764',
    content: 'TS 5.8 带来了一些改进...',
    content_rendered: '<p>TS 5.8...</p>',
    created: 1718956800, // 旧的
    node: { name: 'typescript', title: 'TypeScript' },
  },
];

function mockOkJson(data: unknown): unknown {
  return { ok: true, json: jest.fn().mockResolvedValue(data) };
}

describe('V2exFetcher', () => {
  let fetcher: V2exFetcher;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [V2exFetcher],
    }).compile();
    fetcher = module.get(V2exFetcher);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.v2ex);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 JSON 响应 → 返回正确 FetchedItem[]', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkJson(SAMPLE_DATA));

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('v2ex_1098765');
    expect(items[0].url).toBe('https://www.v2ex.com/t/1098765');
    expect(items[0].publishedAt).toEqual(new Date(1750464000 * 1000));
    expect(items[0].snippet).toContain('Bun');
    // 倒序
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 v2ex 前缀', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /v2ex: fetch failed/,
    );
  });

  // Case 3: keywords 过滤
  it('keywords 过滤：只返回命中的条目', async () => {
    fetchSpy.mockResolvedValueOnce(mockOkJson(SAMPLE_DATA));

    const items = await fetcher.fetch(makeSource(), { keywords: ['Bun'] });

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('Bun');
  });
});
