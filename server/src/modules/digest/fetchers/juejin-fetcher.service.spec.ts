/**
 * JuejinFetcher 单元测试
 * - mock ./http.utils（httpPostJson）
 * - Case 1: 正常 POST 响应 → FetchedItem[]
 * - Case 2: err_no !== 0 → throw Error
 * - Case 3: keywords 本地过滤
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JuejinFetcher } from './juejin-fetcher.service';
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

import { httpPostJson } from './http.utils';
const mockHttpPostJson = httpPostJson as jest.MockedFunction<
  typeof httpPostJson
>;

function makeSource(
  config: Record<string, unknown> = { cateId: '6809637767543259144' },
): InfoSource {
  return {
    _id: 'src_juejin',
    type: InfoSourceType.api,
    fetcherKind: FetcherKind.juejin,
    name: '掘金前端',
    config,
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

const SAMPLE_RESPONSE = {
  err_no: 0,
  data: [
    {
      article_info: {
        article_id: '7234567890123456',
        title: '写给年轻程序员的几点建议-2',
        brief_content: '本文给出 6 条建议，帮助你成长...',
        ctime: '1718956800',
      },
    },
    {
      article_info: {
        article_id: '7234567890000001',
        title: 'React 19 新特性解析',
        brief_content: 'React 19 带来了并发模式改进...',
        ctime: '1718870400',
      },
    },
  ],
};

describe('JuejinFetcher', () => {
  let fetcher: JuejinFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JuejinFetcher],
    }).compile();
    fetcher = module.get(JuejinFetcher);
    jest.clearAllMocks();
  });

  it('kind 属性正确', () => {
    expect(fetcher.kind).toBe(FetcherKind.juejin);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: 正常解析
  it('正常 POST 响应 → 返回正确 FetchedItem[]', async () => {
    mockHttpPostJson.mockResolvedValueOnce(SAMPLE_RESPONSE);

    const items = await fetcher.fetch(makeSource(), { limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0].itemGuid).toBe('juejin_7234567890123456');
    expect(items[0].url).toBe('https://juejin.cn/post/7234567890123456');
    expect(items[0].title).toBe('写给年轻程序员的几点建议-2');
    expect(items[0].snippet).toContain('建议');
    expect(items[0].publishedAt).toEqual(new Date(1718956800 * 1000));
    // 倒序（ctime 较大的在前）
    expect(items[0].publishedAt!.getTime()).toBeGreaterThan(
      items[1].publishedAt!.getTime(),
    );
  });

  // Case 2: API 错误码
  it('err_no !== 0 → throw Error 含 juejin 前缀', async () => {
    mockHttpPostJson.mockResolvedValueOnce({
      err_no: 10001,
      err_msg: 'rate limit',
      data: [],
    });

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      /juejin: API error/,
    );
  });

  // Case 3: keywords 过滤
  it('keywords 过滤：只返回命中的条目', async () => {
    mockHttpPostJson.mockResolvedValueOnce(SAMPLE_RESPONSE);

    const items = await fetcher.fetch(makeSource(), { keywords: ['React'] });

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('React');
  });
});
