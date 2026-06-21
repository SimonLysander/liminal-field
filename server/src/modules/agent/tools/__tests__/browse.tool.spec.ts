/**
 * browse (v4) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：拉到 3 条，历史无去重，分配 item ref，写入 fetchedItemsMap（存 sourceId）
 *   2. sourceId 不存在 → error SOURCE_NOT_FOUND
 *   3. 历史去重：已有 1 条 → afterDedupe = 2
 *   4. source 已禁用 → error SOURCE_DISABLED
 *   5. limit 参数：只返回 limit 条（但 afterDedupe 计数仍反映去重后总数）
 */

import { createBrowseTool } from '../browse.tool';
import type { InfoSourceRepository } from '../../../digest/info-source.repository';
import type { FetcherRegistry } from '../../../digest/fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../../digest/processed-feed-item.repository';
import type { DigestTaskContext } from '../digest-task-context';
import type { InfoSource } from '../../../digest/info-source.entity';
import type { FetchedItem } from '../../../digest/fetchers/fetcher.interface';
import {
  InfoSourceType,
  InfoSourceCategory,
} from '../../../digest/info-source.entity';

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
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

function makeInfoSourceRepo(source: InfoSource | null): InfoSourceRepository {
  return {
    findById: jest.fn().mockResolvedValue(source),
  } as unknown as InfoSourceRepository;
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

function makeCtx(): DigestTaskContext {
  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { item: 0 },
    fetchedItemsMap: new Map(),
  };
}

describe('browse (v4)', () => {
  it('Case 1: 正常 — 分配 ref i1/i2/i3，写入 fetchedItemsMap（含 sourceId）', async () => {
    const source = makeSource();
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo(source),
      fetcherRegistry: makeFetcherRegistry([
        makeItem(1),
        makeItem(2),
        makeItem(3),
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { sourceId: 'src_001' }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.afterDedupe).toBe(3);
    expect(result.meta.items).toHaveLength(3);
    expect(result.meta.items[0].ref).toBe('i1');
    expect(ctx.fetchedItemsMap.size).toBe(3);
    // v4: fetchedItemsMap 存 sourceId 而非 sourceRef
    expect(ctx.fetchedItemsMap.get('i1')?.sourceId).toBe('src_001');
  });

  it('Case 2: sourceId 不存在 → error SOURCE_NOT_FOUND', async () => {
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo(null), // null = 不存在
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { sourceId: 'src_999' }));
    expect(result.meta.status).toBe('error');
    expect(result.meta.errorCode).toBe('SOURCE_NOT_FOUND');
  });

  it('Case 3: 历史去重 — 1 条已有 → afterDedupe = 2', async () => {
    const source = makeSource();
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo(source),
      fetcherRegistry: makeFetcherRegistry([
        makeItem(1),
        makeItem(2),
        makeItem(3),
      ]),
      pfiRepo: makePfiRepo(['guid_1']), // guid_1 已处理过
      ctx,
    });

    const result = JSON.parse(await run(tool, { sourceId: 'src_001' }));
    expect(result.meta.afterDedupe).toBe(2);
    expect(result.meta.totalFetched).toBe(3);
  });

  it('Case 4: source 已禁用 → error SOURCE_DISABLED', async () => {
    const source = makeSource(false); // enabled=false
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo(source),
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { sourceId: 'src_001' }));
    expect(result.meta.errorCode).toBe('SOURCE_DISABLED');
  });

  it('Case 5: limit 参数 — 只返回 limit 条', async () => {
    const source = makeSource();
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo(source),
      fetcherRegistry: makeFetcherRegistry([
        makeItem(1),
        makeItem(2),
        makeItem(3),
        makeItem(4),
        makeItem(5),
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(
      await run(tool, { sourceId: 'src_001', limit: 2 }),
    );
    expect(result.meta.status).toBe('ok');
    expect(result.meta.afterDedupe).toBe(5); // 去重后总数仍是 5
    expect(result.meta.items).toHaveLength(2); // 但只返回 2 条
    expect(ctx.fetchedItemsMap.size).toBe(2);
  });
});
