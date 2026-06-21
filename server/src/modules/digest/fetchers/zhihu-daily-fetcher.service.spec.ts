/**
 * ZhihuDailyFetcher 单元测试
 * - mock ./http.utils（httpGetJson）
 * - Case 1: 正常响应 → FetchedItem[]，publishedAt 从 YYYYMMDD 解析正确
 * - Case 2: HTTP 非 2xx → throw Error
 * - Case 3: keywords 本地过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ZhihuDailyFetcher } from './zhihu-daily-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

jest.mock('./http.utils', () => {
  const actual = jest.requireActual('./http.utils');
  return {
    ...actual,
    httpGetJson: jest.fn(),
    httpGetText: jest.fn(),
    httpPostJson: jest.fn(),
    httpFetch: jest.fn(),
  };
});

import { httpGetJson } from './http.utils';
const mockHttpGetJson = httpGetJson as jest.MockedFunction<typeof httpGetJson>;

function makeSource(): InfoSource {
  return {
    _id: 'src_zhihu',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.zhihu_daily,
    name: '知乎日报',
    config: {},
    enabled: true,
    category: InfoSourceCategory.longform,
    createdAt: new Date(),
  };
}

const SAMPLE_RESPONSE = {
  date: '20260621',
  stories: [
    {
      id: 9790569,
      title: '杜拉斯的《情人》之所以那么著名,关键原因是什么？',
      url: 'https://daily.zhihu.com/story/9790569',
      hint: '鞭临天下 · 12 分钟阅读',
    },
    {
      id: 9790570,
      title: '为什么程序员都喜欢用黑色背景？',
      url: 'https://daily.zhihu.com/story/9790570',
      hint: '知乎用户 · 8 分钟阅读',
    },
  ],
};

describe('ZhihuDailyFetcher', () => {
  let fetcher: ZhihuDailyFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ZhihuDailyFetcher],
    }).compile();
    fetcher = module.get(ZhihuDailyFetcher);
    jest.clearAllMocks();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.zhihu_daily);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析，publishedAt 从 YYYYMMDD 解析
  it('正常响应 → FetchedItem[]，publishedAt 解析为 UTC 0 点', async () => {
    mockHttpGetJson.mockResolvedValueOnce(SAMPLE_RESPONSE);

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('zhihu_daily_9790569');
    expect(items[0].url).toBe('https://daily.zhihu.com/story/9790569');
    expect(items[0].title).toContain('杜拉斯');
    expect(items[0].snippet).toBe('鞭临天下 · 12 分钟阅读');
    // 2026-06-21 UTC 0 点
    expect(items[0].publishedAt).toEqual(new Date('2026-06-21T00:00:00.000Z'));
  });

  // Case 2: HTTP 错误
  it('HTTP 非 2xx → throw Error 含 zhihu_daily 前缀', async () => {
    mockHttpGetJson.mockRejectedValueOnce(
      new Error(
        'HTTP 403 Forbidden url=https://news-at.zhihu.com/api/4/news/latest',
      ),
    );

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /zhihu_daily: fetch failed/,
    );
  });

  // Case 3: keywords 过滤
  it('keywords 过滤：只返回命中的条目', async () => {
    mockHttpGetJson.mockResolvedValueOnce(SAMPLE_RESPONSE);

    const items = await fetcher.fetch(makeSource(), { keywords: ['程序员'] });

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('程序员');
  });
});
