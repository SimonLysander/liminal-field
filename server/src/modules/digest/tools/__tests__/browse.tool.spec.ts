/**
 * browse (v3) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：拉到 3 条，历史无去重，分配 item ref，写入 fetchedItemsMap
 *   2. source ref 不存在 → error SOURCE_NOT_FOUND
 *   3. 历史去重：已有 1 条 → afterDedupe = 2
 *   4. source 已禁用 → error SOURCE_DISABLED
 */

import { createBrowseTool } from '../browse.tool';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { TaskContext } from '../digest-tools.factory';
import type { InfoSource } from '../../info-source.entity';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import { InfoSourceType, InfoSourceCategory } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeItem(id: number): FetchedItem {
  return {
    itemGuid: `guid_${id}`,
    title: `标题 ${id}`,
    url: `https://example.com/${id}`,
    publishedAt: new Date('2026-06-15'),
    snippet: `摘要 ${id}`.repeat(10),
  };
}

function makeSource(enabled = true): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'HN',
    config: { url: 'https://hn.algolia.com/feed' },
    enabled,
    category: InfoSourceCategory.tech,
    createdAt: new Date(),
  };
}

function makeFetcherRegistry(items: FetchedItem[]): FetcherRegistry {
  return {
    get: jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue(items),
    }),
  } as unknown as FetcherRegistry;
}

function makePfiRepo(
  existingGuids: string[] = [],
): ProcessedFeedItemRepository {
  return {
    findExistingGuids: jest.fn().mockResolvedValue(existingGuids),
  } as unknown as ProcessedFeedItemRepository;
}

function makeCtx(sourceMap?: Map<string, InfoSource>): TaskContext {
  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 2, item: 0 }, // 假设已分配了 s1/s2
    sourceRefsMap: sourceMap ?? new Map(),
    fetchedItemsMap: new Map(),
  };
}

describe('browse (v3)', () => {
  it('Case 1: 正常 — 分配 ref i1/i2/i3，写入 fetchedItemsMap', async () => {
    const source = makeSource();
    const ctx = makeCtx(new Map([['s1', source]]));
    const tool = createBrowseTool({
      fetcherRegistry: makeFetcherRegistry([
        makeItem(1),
        makeItem(2),
        makeItem(3),
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { source: 's1' }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.afterDedupe).toBe(3);
    expect(result.meta.items).toHaveLength(3);
    expect(result.meta.items[0].ref).toBe('i1');
    expect(ctx.fetchedItemsMap.size).toBe(3);
    expect(ctx.fetchedItemsMap.has('i1')).toBe(true);
  });

  it('Case 2: source ref 不存在 → error SOURCE_NOT_FOUND', async () => {
    const ctx = makeCtx(new Map());
    const tool = createBrowseTool({
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { source: 's99' }));
    expect(result.meta.status).toBe('error');
    expect(result.meta.errorCode).toBe('SOURCE_NOT_FOUND');
  });

  it('Case 3: 历史去重 — 1 条已有 → afterDedupe = 2', async () => {
    const source = makeSource();
    const ctx = makeCtx(new Map([['s1', source]]));
    const tool = createBrowseTool({
      fetcherRegistry: makeFetcherRegistry([
        makeItem(1),
        makeItem(2),
        makeItem(3),
      ]),
      pfiRepo: makePfiRepo(['guid_1']), // guid_1 已处理过
      ctx,
    });

    const result = JSON.parse(await run(tool, { source: 's1' }));
    expect(result.meta.afterDedupe).toBe(2);
    expect(result.meta.totalFetched).toBe(3);
  });

  it('Case 4: source 已禁用 → error SOURCE_DISABLED', async () => {
    const source = makeSource(false); // enabled=false
    const ctx = makeCtx(new Map([['s1', source]]));
    const tool = createBrowseTool({
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { source: 's1' }));
    expect(result.meta.errorCode).toBe('SOURCE_DISABLED');
  });
});
