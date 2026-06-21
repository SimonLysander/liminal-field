/**
 * HnFirebaseFetcher 单元测试
 * - mock ./http.utils（httpGetJson）
 * - Case 1: 正常流程（topstories + 并行详情）→ FetchedItem[]
 * - Case 2: topstories 请求失败 → throw Error
 * - Case 3: since 过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { HnFirebaseFetcher } from './hn-firebase-fetcher.service';
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

import { httpGetJson } from './http.utils';
const mockHttpGetJson = httpGetJson as jest.MockedFunction<typeof httpGetJson>;

function makeSource(): InfoSource {
  return {
    _id: 'src_hn',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.hn_firebase,
    name: 'Hacker News',
    config: {},
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

const SAMPLE_ITEM = {
  by: 'dang',
  id: 40123456,
  score: 250,
  time: 1750464000, // 2025-06-21T00:00:00Z
  title: 'Show HN: Cool new tool',
  url: 'https://example.com/cool-tool',
  type: 'story',
};

const SAMPLE_ITEM_2 = {
  by: 'foo',
  id: 40123457,
  score: 100,
  time: 1718956800, // 2024-06-21T08:00:00Z（旧的）
  title: 'Old story',
  url: 'https://example.com/old',
  type: 'story',
};

describe('HnFirebaseFetcher', () => {
  let fetcher: HnFirebaseFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HnFirebaseFetcher],
    }).compile();
    fetcher = module.get(HnFirebaseFetcher);
    jest.clearAllMocks();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.hn_firebase);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常流程
  it('topstories + item 详情 → 返回正确 FetchedItem[]', async () => {
    // 第一次调用：topstories（limit=2 只取前 2 条）
    mockHttpGetJson
      .mockResolvedValueOnce([40123456, 40123457])
      .mockResolvedValueOnce(SAMPLE_ITEM)
      .mockResolvedValueOnce(SAMPLE_ITEM_2);

    const items = await fetcher.fetch(makeSource(), { limit: 2 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('hn_40123456');
    expect(items[0].title).toBe('Show HN: Cool new tool');
    expect(items[0].url).toBe('https://example.com/cool-tool');
    expect(items[0].publishedAt).toEqual(new Date(SAMPLE_ITEM.time * 1000));
    expect(items[0].snippet).toContain('score=250');
    // 时间倒序（较新的在前）
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: topstories 失败
  it('topstories 请求失败 → throw Error 含 hn_firebase 前缀', async () => {
    mockHttpGetJson.mockRejectedValueOnce(
      new Error(
        'HTTP 500 Internal Server Error url=https://hacker-news.firebaseio.com/v0/topstories.json',
      ),
    );

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /hn_firebase: topstories fetch failed/,
    );
  });

  // Case 3: since 过滤
  it('since 过滤：只返回 since 之后发布的 story', async () => {
    mockHttpGetJson
      .mockResolvedValueOnce([40123456, 40123457])
      .mockResolvedValueOnce(SAMPLE_ITEM)
      .mockResolvedValueOnce(SAMPLE_ITEM_2);

    // since 设为 2025-01-01，只有 SAMPLE_ITEM（2025-06-21）通过
    const since = new Date('2025-01-01T00:00:00Z');
    const items = await fetcher.fetch(makeSource(), { limit: 5, since });

    expect(items).toHaveLength(1);
    expect(items[0].itemGuid).toBe('hn_40123456');
  });
});
