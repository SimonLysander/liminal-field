/**
 * search (v3) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：命中 2 条，分配 ref，写入 fetchedItemsMap
 *   2. 0 命中 → status:ok total:0（不是 error）
 *   3. 限定 sources = ['s1']，只搜指定源
 */

import { createSearchTool } from '../search.tool';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { TaskContext } from '../digest-tools.factory';
import type { InfoSource } from '../../info-source.entity';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import { InfoSourceType } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeItem(id: number): FetchedItem {
  return {
    itemGuid: `guid_${id}`,
    title: `搜索结果 ${id}`,
    url: `https://example.com/${id}`,
    publishedAt: new Date('2026-06-15'),
    snippet: `摘要 ${id}`,
  };
}

function makeSource(name: string): InfoSource {
  return {
    _id: `src_${name}`,
    type: InfoSourceType.rss,
    name,
    config: {},
    enabled: true,
    createdAt: new Date(),
  };
}

function makeFetcherRegistry(items: FetchedItem[]): FetcherRegistry {
  return {
    get: jest.fn().mockReturnValue({
      search: jest.fn().mockResolvedValue(items),
    }),
  } as unknown as FetcherRegistry;
}

function makePfiRepo(): ProcessedFeedItemRepository {
  return {
    findExistingGuids: jest.fn().mockResolvedValue([]),
  } as unknown as ProcessedFeedItemRepository;
}

function makeStcRepo(): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue({
      sourceIds: ['src_HN'],
    }),
  } as unknown as SmartTopicConfigRepository;
}

function makeCtx(sources?: Record<string, InfoSource>): TaskContext {
  const map = new Map<string, InfoSource>();
  if (sources) {
    for (const [ref, src] of Object.entries(sources)) {
      map.set(ref, src);
    }
  }
  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 1, item: 0 },
    sourceRefsMap: map,
    fetchedItemsMap: new Map(),
  };
}

describe('search (v3)', () => {
  it('Case 1: 正常 — 命中 2 条，分配 ref，写入 fetchedItemsMap', async () => {
    const ctx = makeCtx({ s1: makeSource('HN') });
    const tool = createSearchTool({
      fetcherRegistry: makeFetcherRegistry([makeItem(1), makeItem(2)]),
      pfiRepo: makePfiRepo(),
      stcRepo: makeStcRepo(),
      ctx,
    });

    const result = JSON.parse(
      await run(tool, { query: 'AI', sources: ['s1'] }),
    );

    expect(result.meta.status).toBe('ok');
    expect(result.meta.total).toBe(2);
    expect(result.meta.items).toHaveLength(2);
    expect(ctx.fetchedItemsMap.size).toBe(2);
    expect(ctx.fetchedItemsMap.has('i1')).toBe(true);
  });

  it('Case 2: 0 命中 → status:ok total:0（不是 error）', async () => {
    const ctx = makeCtx({ s1: makeSource('HN') });
    const tool = createSearchTool({
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      stcRepo: makeStcRepo(),
      ctx,
    });

    const result = JSON.parse(
      await run(tool, { query: '冷门关键词', sources: ['s1'] }),
    );
    expect(result.meta.status).toBe('ok');
    expect(result.meta.total).toBe(0);
  });

  it("Case 3: 限定 sources=['s1']，fetcherRegistry 只被调用一次", async () => {
    const ctx = makeCtx({ s1: makeSource('HN'), s2: makeSource('Reddit') });
    const fetcherRegistry = makeFetcherRegistry([makeItem(1)]);
    const tool = createSearchTool({
      fetcherRegistry,
      pfiRepo: makePfiRepo(),
      stcRepo: makeStcRepo(),
      ctx,
    });

    await run(tool, { query: 'AI', sources: ['s1'] });

    // 只有一个源被搜索（s1），s2 未被搜索
    const mockSearch = (fetcherRegistry.get as jest.Mock).mock.results[0]?.value
      .search as jest.Mock;
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });
});
