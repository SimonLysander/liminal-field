/**
 * RssFetcher 单元测试
 *
 * 用 jest.mock 替掉 rss-parser，完全不发真实 HTTP 请求。
 * fixture 覆盖：正常路径、limit、since、url 非法、parser 异常、search、readFull。
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

describe('RssFetcher', () => {
  let fetcher: RssFetcher;

  beforeEach(async () => {
    mockParseURL.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RssFetcher],
    }).compile();

    fetcher = module.get(RssFetcher);
  });

  // Case 1: fetch 正常路径 — 验证字段映射
  describe('fetch - 正常路径', () => {
    it('应正确将 rss-parser 返回结果映射为 FetchedItem[]', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });

      const result = await fetcher.fetch({ url: 'https://example.com/rss' });

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
      const result = await fetcher.fetch({ url: 'https://example.com/rss' });
      // 最新的应排第一
      expect(result[0].itemGuid).toBe('guid-1');
      expect(result[2].itemGuid).toBe('guid-3');
    });

    it('itemGuid 退化链：无 guid 用 link', async () => {
      const itemWithoutGuid = { ...FIXTURE_ITEMS[0], guid: undefined };
      mockParseURL.mockResolvedValueOnce({ items: [itemWithoutGuid] });
      const result = await fetcher.fetch({ url: 'https://example.com/rss' });
      expect(result[0].itemGuid).toBe('https://example.com/post/1');
    });

    it('itemGuid 退化链：无 guid 无 link 用 url#index', async () => {
      const itemNoGuidNoLink = {
        ...FIXTURE_ITEMS[0],
        guid: undefined,
        link: undefined,
      };
      mockParseURL.mockResolvedValueOnce({ items: [itemNoGuidNoLink] });
      const result = await fetcher.fetch({ url: 'https://example.com/rss' });
      expect(result[0].itemGuid).toBe('https://example.com/rss#0');
    });
  });

  // Case 2: fetch options.limit 截断
  it('应按 options.limit 截断返回条数', async () => {
    mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
    const result = await fetcher.fetch(
      { url: 'https://example.com/rss' },
      { limit: 2 },
    );
    expect(result).toHaveLength(2);
  });

  // Case 3: fetch options.since 过滤
  it('应按 options.since 过滤旧条目', async () => {
    mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
    // since = 2024-02-01，应只剩 guid-1（2024-03-01）和 guid-2（2024-02-15）
    const since = new Date('2024-02-01T00:00:00.000Z');
    const result = await fetcher.fetch(
      { url: 'https://example.com/rss' },
      { since },
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.itemGuid)).toEqual(['guid-1', 'guid-2']);
  });

  // Case 4: url 非法抛 BadRequestException
  it('url 非法时应 throw BadRequestException', async () => {
    await expect(fetcher.fetch({ url: 'not-a-url' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(fetcher.fetch({ url: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(fetcher.fetch({ url: undefined })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      fetcher.fetch({ url: 'ftp://example.com/rss' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Case 5: parser 失败抛 Error，logger.error 被调用
  it('parser 失败时应 throw Error 并调用 logger.error', async () => {
    const networkErr = new Error('ECONNREFUSED');
    mockParseURL.mockRejectedValueOnce(networkErr);

    // spy on logger.error

    const loggerError = jest
      .spyOn((fetcher as any).logger, 'error')
      .mockImplementation(() => {});

    await expect(
      fetcher.fetch({ url: 'https://example.com/rss' }),
    ).rejects.toThrow('rss: fetch failed');
    expect(loggerError).toHaveBeenCalled();
  });

  // Case 6: search 命中过滤
  describe('search', () => {
    it('应过滤出 title 或 snippet 含 query 的条目', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.search(
        { url: 'https://example.com/rss' },
        'TypeScript',
      );
      expect(result).toHaveLength(1);
      expect(result[0].itemGuid).toBe('guid-2');
    });

    it('query 不区分大小写', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.search(
        { url: 'https://example.com/rss' },
        'nestjs',
      );
      expect(result).toHaveLength(1);
      expect(result[0].itemGuid).toBe('guid-1');
    });

    it('无匹配时返回空数组', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.search(
        { url: 'https://example.com/rss' },
        'xxxxxxxxxxxxxxx',
      );
      expect(result).toHaveLength(0);
    });
  });

  // Case 7: readFull 找不到 itemGuid 抛 Error
  describe('readFull', () => {
    it('找到 itemGuid 且有 content:encoded 时应返回全文', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      const result = await fetcher.readFull(
        { url: 'https://example.com/rss' },
        'guid-1',
      );
      expect(result).toBe('<article>Full content of NestJS 10 post</article>');
    });

    it('找到 itemGuid 但无 content:encoded 时应 throw Error', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      await expect(
        fetcher.readFull({ url: 'https://example.com/rss' }, 'guid-2'),
      ).rejects.toThrow('rss: full content not available');
    });

    it('找不到 itemGuid 时应 throw Error', async () => {
      mockParseURL.mockResolvedValueOnce({ items: FIXTURE_ITEMS });
      await expect(
        fetcher.readFull(
          { url: 'https://example.com/rss' },
          'non-existent-guid',
        ),
      ).rejects.toThrow('rss: full content not available');
    });
  });
});
