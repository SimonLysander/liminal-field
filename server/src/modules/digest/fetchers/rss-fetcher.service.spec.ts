/**
 * RssFetcher 单元测试（Fetcher 插件架构 v2）
 *
 * v2 关键变化：
 * - fetch 第 1 参改为 InfoSource 实例（用 makeSource helper 构造测试 fixture）
 * - 删除 search? / readFull? 测试（接口移除）
 * - 新增 keywords 本地过滤测试（OR 语义、不区分大小写）
 *
 * 用 jest.mock 替掉 rss-parser，完全不发真实 HTTP 请求。
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

// --- rss-parser mock（必须在 import 前声明）---
const mockParseURL = jest.fn();

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL,
  }));
});

import { RssFetcher } from './rss-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

/** 构造测试用 InfoSource 实例，只填测试关心的字段 */
function makeSource(url = 'https://example.com/rss'): InfoSource {
  return {
    _id: 'src_test',
    type: InfoSourceType.rss,
    fetcherKind: FetcherKind.rss,
    name: 'Test Feed',
    config: { url },
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

/** 标准 fixture items */
const FIXTURE_ITEMS = [
  {
    guid: 'guid-1',
    title: 'NestJS 10 Released',
    link: 'https://example.com/post/1',
    isoDate: '2024-03-01T10:00:00.000Z',
    contentSnippet:
      'NestJS version 10 is now available with many improvements.',
    content:
      '<p>NestJS version 10 is now available with many improvements.</p>',
    'content:encoded': '<article>Full content of NestJS 10 post</article>',
  },
  {
    guid: 'guid-2',
    title: 'TypeScript Tips',
    link: 'https://example.com/post/2',
    isoDate: '2024-02-15T08:00:00.000Z',
    contentSnippet: 'Ten tips for better TypeScript code.',
    content: '<p>Ten tips for better TypeScript code.</p>',
    'content:encoded': undefined,
  },
  {
    guid: 'guid-3',
    title: 'Node.js Performance Guide',
    link: 'https://example.com/post/3',
    isoDate: '2024-01-20T12:00:00.000Z',
    contentSnippet: 'How to optimize Node.js applications for high throughput.',
    content: '<p>How to optimize Node.js applications.</p>',
    'content:encoded': undefined,
  },
];

describe('RssFetcher (v2)', () => {
  let fetcher: RssFetcher;

  beforeEach(async () => {
    mockParseURL.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RssFetcher],
    }).compile();

    fetcher = module.get(RssFetcher);
  });

  it('kind = rss, supportsServerQuery = false (RSS 协议无 query)', () => {
    expect(fetcher.kind).toBe(FetcherKind.rss);
    expect(fetcher.supportsServerQuery).toBe(false);
  });

  // Case 1: fetch 正常路径 — 验证字段映射
  describe('fetch - 正常路径', () => {
    it('应正确将 rss-parser 返回结果映射为 FetchedItem[]', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });

      const result = await fetcher.fetch(makeSource());

      expect(result).toHaveLength(3);

      // 最新的排第一
      const first = result[0];
      expect(first.itemGuid).toBe('guid-1');
      expect(first.title).toBe('NestJS 10 Released');
      expect(first.url).toBe('https://example.com/post/1');
      expect(first.publishedAt).toEqual(new Date('2024-03-01T10:00:00.000Z'));
      expect(first.snippet).toBe(
        'NestJS version 10 is now available with many improvements.',
      );
    });

    it('应按 publishedAt 倒序排列', async () => {
      mockParseURL.mockResolvedValueOnce({
        items: [...FIXTURE_ITEMS].reverse(),
      });
      const result = await fetcher.fetch(makeSource());
      expect(result[0].itemGuid).toBe('guid-1');
      expect(result[2].itemGuid).toBe('guid-3');
    });

    it('itemGuid 退化链：无 guid 用 link', async () => {
      const itemWithoutGuid = { ...FIXTURE_ITEMS[0], guid: undefined };
      mockParseURL.mockResolvedValueOnce({ items: [itemWithoutGuid] });
      const result = await fetcher.fetch(makeSource());
      expect(result[0].itemGuid).toBe('https://example.com/post/1');
    });

    it('itemGuid 退化链：无 guid 无 link 用 url#index', async () => {
      const itemNoGuidNoLink = {
        ...FIXTURE_ITEMS[0],
        guid: undefined,
        link: undefined,
      };
      mockParseURL.mockResolvedValueOnce({ items: [itemNoGuidNoLink] });
      const result = await fetcher.fetch(makeSource());
      expect(result[0].itemGuid).toBe('https://example.com/rss#0');
    });
  });

  // Case 2: fetch options.limit 截断
  it('应按 options.limit 截断返回条数', async () => {
    mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
    const result = await fetcher.fetch(makeSource(), { limit: 2 });
    expect(result).toHaveLength(2);
  });

  // Case 3: fetch options.since 过滤
  it('应按 options.since 过滤旧条目', async () => {
    mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
    const since = new Date('2024-02-01T00:00:00.000Z');
    const result = await fetcher.fetch(makeSource(), { since });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.itemGuid)).toEqual(['guid-1', 'guid-2']);
  });

  // Case 4: url 非法抛 BadRequestException
  it('url 非法时应 throw BadRequestException', async () => {
    await expect(fetcher.fetch(makeSource('not-a-url'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(fetcher.fetch(makeSource(''))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      fetcher.fetch(makeSource('ftp://example.com/rss')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Case 5: parser 失败抛 Error，logger.error 被调用
  it('parser 失败时应 throw Error 并调用 logger.error', async () => {
    const networkErr = new Error('ECONNREFUSED');
    mockParseURL.mockRejectedValueOnce(networkErr);

    const loggerError = jest
      .spyOn(
        (fetcher as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(fetcher.fetch(makeSource())).rejects.toThrow(
      'rss: fetch failed',
    );
    expect(loggerError).toHaveBeenCalled();
  });

  // Case 6: keywords 本地过滤（v2 新能力）
  describe('keywords 本地过滤', () => {
    it('应过滤出 title 或 snippet 含任一 keyword 的条目', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.fetch(makeSource(), {
        keywords: ['TypeScript'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].itemGuid).toBe('guid-2');
    });

    it('keywords 不区分大小写', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.fetch(makeSource(), {
        keywords: ['nestjs'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].itemGuid).toBe('guid-1');
    });

    it('多 keyword 走 OR 语义：命中任一即返回', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.fetch(makeSource(), {
        keywords: ['NestJS', 'Performance'],
      });
      // guid-1 (NestJS) + guid-3 (Performance Guide)
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.itemGuid).sort()).toEqual([
        'guid-1',
        'guid-3',
      ]);
    });

    it('无匹配时返回空数组', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.fetch(makeSource(), {
        keywords: ['xxxxxxxxxxxxxxx'],
      });
      expect(result).toHaveLength(0);
    });

    it('空 keywords 数组等价于不过滤', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.fetch(makeSource(), { keywords: [] });
      expect(result).toHaveLength(3);
    });
  });
});
