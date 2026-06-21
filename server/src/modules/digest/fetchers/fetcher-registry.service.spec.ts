/**
 * FetcherRegistry 单元测试（Fetcher 插件架构 v2）
 *
 * 覆盖：
 * - get(kind) 按 FetcherKind 路由
 * - 单源 fetch 透传到具体 fetcher
 * - fetchMany 并行 + Promise.allSettled + 单源失败不挂整次
 * - 禁用源直接 skip
 */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

// mock rss-parser 避免 RssFetcher 构造时报错
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({ parseURL: jest.fn() }));
});

import { FetcherRegistry } from './fetcher-registry.service';
import { RssFetcher } from './rss-fetcher.service';
import { FetcherKind } from './fetcher.interface';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from '../info-source.entity';

function makeSource(overrides: Partial<InfoSource> = {}): InfoSource {
  return {
    _id: 'src_test',
    type: InfoSourceType.rss,
    fetcherKind: FetcherKind.rss,
    name: 'Test Feed',
    config: { url: 'https://example.com/rss' },
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('FetcherRegistry (v2)', () => {
  let registry: FetcherRegistry;
  let rssFetcher: RssFetcher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RssFetcher, FetcherRegistry],
    }).compile();

    registry = module.get(FetcherRegistry);
    rssFetcher = module.get(RssFetcher);
  });

  // Case 1: get(rss) 返回 RssFetcher
  it('get(FetcherKind.rss) 应返回 RssFetcher 实例', () => {
    const fetcher = registry.get(FetcherKind.rss);
    expect(fetcher).toBe(rssFetcher);
    expect(fetcher.kind).toBe(FetcherKind.rss);
  });

  // Case 2: 未注册的 kind 抛 BadRequestException
  it('get(尚未注册的 kind) 应 throw BadRequestException', () => {
    expect(() => registry.get(FetcherKind.arxiv)).toThrow(BadRequestException);
    expect(() => registry.get(FetcherKind.hn_firebase)).toThrow(
      BadRequestException,
    );
  });

  // Case 3: 单源 fetch 透传
  describe('fetch (单源)', () => {
    it('应按 source.fetcherKind 路由并调具体 fetcher.fetch', async () => {
      const fakeItems = [
        {
          itemGuid: 'g1',
          title: 't1',
          url: 'u1',
          snippet: 's1',
          publishedAt: new Date(),
        },
      ];
      const spy = jest
        .spyOn(rssFetcher, 'fetch')
        .mockResolvedValueOnce(fakeItems);

      const source = makeSource();
      const result = await registry.fetch(source, { limit: 10 });

      expect(spy).toHaveBeenCalledWith(source, { limit: 10 });
      expect(result).toBe(fakeItems);
    });

    it('单源 fetch 失败时 throw（与原签名一致，不做 allSettled 包装）', async () => {
      jest.spyOn(rssFetcher, 'fetch').mockRejectedValueOnce(new Error('boom'));
      await expect(registry.fetch(makeSource())).rejects.toThrow('boom');
    });
  });

  // Case 4: fetchMany 并行 + 单源失败不阻塞
  describe('fetchMany (多源并行)', () => {
    it('多源全部成功时 → 每条 status=ok + items 透传', async () => {
      jest
        .spyOn(rssFetcher, 'fetch')
        .mockResolvedValueOnce([
          { itemGuid: 'a1', title: 'A1', url: '', snippet: '' },
        ])
        .mockResolvedValueOnce([
          { itemGuid: 'b1', title: 'B1', url: '', snippet: '' },
        ]);

      const sources = [
        makeSource({ _id: 'src_a', name: 'A' }),
        makeSource({ _id: 'src_b', name: 'B' }),
      ];
      const results = await registry.fetchMany(sources);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('ok');
      expect(results[0].source._id).toBe('src_a');
      expect(results[0].items).toHaveLength(1);
      expect(results[1].status).toBe('ok');
      expect(results[1].items[0].itemGuid).toBe('b1');
    });

    it('某一源 fetch 抛错时 → 该条 status=failed + error，其他源不挂', async () => {
      jest
        .spyOn(rssFetcher, 'fetch')
        .mockRejectedValueOnce(new Error('源 A 抓取失败'))
        .mockResolvedValueOnce([
          { itemGuid: 'b1', title: 'B1', url: '', snippet: '' },
        ]);

      const sources = [
        makeSource({ _id: 'src_a', name: 'A' }),
        makeSource({ _id: 'src_b', name: 'B' }),
      ];
      const results = await registry.fetchMany(sources);

      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('源 A 抓取失败');
      expect(results[0].items).toEqual([]);

      expect(results[1].status).toBe('ok');
      expect(results[1].items).toHaveLength(1);
    });

    it('禁用源应被 skip（不进入返回）', async () => {
      const fetchSpy = jest
        .spyOn(rssFetcher, 'fetch')
        .mockResolvedValueOnce([]);

      const sources = [
        makeSource({ _id: 'src_a', name: 'A', enabled: true }),
        makeSource({ _id: 'src_b', name: 'B (disabled)', enabled: false }),
      ];
      const results = await registry.fetchMany(sources);

      // 只有 enabled=true 的源被 fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].source._id).toBe('src_a');
    });

    it('keywords 透传给具体 fetcher', async () => {
      const spy = jest.spyOn(rssFetcher, 'fetch').mockResolvedValueOnce([]);
      const sources = [makeSource()];
      await registry.fetchMany(sources, {
        keywords: ['transformer', 'MoE'],
      });
      expect(spy).toHaveBeenCalledWith(sources[0], {
        keywords: ['transformer', 'MoE'],
      });
    });
  });
});
