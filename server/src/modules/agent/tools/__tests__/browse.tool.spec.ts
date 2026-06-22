/**
 * browse (v5) 工具单元测试
 *
 * v5 新签名: { sourceIds?, keywords?, limit? },多源并行
 *
 * 覆盖:
 *   1. 默认无参:自动扫当前事项订阅的所有 enabled 源
 *   2. 显式 sourceIds 含 invalid / disabled id → partial
 *   3. 历史去重
 *   4. 单源失败 + 其他源成功 → partial + failedSources
 *   5. 所有源失败 → ALL_SOURCES_FAILED
 *   6. 事项无订阅源 → NO_SUBSCRIBED_SOURCES
 *   7. limit 参数生效(合并 + 去重后 cap)
 *   8. keywords 透传给 FetcherRegistry.fetchMany
 */

import { createBrowseTool } from '../browse.tool';
import type { InfoSourceRepository } from '../../../digest/info-source.repository';
import type { SmartTopicConfigRepository } from '../../../digest/smart-topic-config.repository';
import type {
  FetcherRegistry,
  FetchManyResultPerSource,
} from '../../../digest/fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../../digest/processed-feed-item.repository';
import type { DigestTaskContext } from '../digest-task-context';
import type { InfoSource } from '../../../digest/info-source.entity';
import {
  type FetchedItem,
  FetcherKind,
} from '../../../digest/fetchers/fetcher.interface';
import {
  InfoSourceType,
  InfoSourceCategory,
} from '../../../digest/info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeItem(
  srcKey: string,
  id: number,
  publishedOffsetDays = 0,
): FetchedItem {
  return {
    itemGuid: `guid_${srcKey}_${id}`,
    title: `${srcKey} item ${id}`,
    url: `https://example.com/${srcKey}/${id}`,
    publishedAt: new Date(Date.now() - publishedOffsetDays * 86400_000),
    snippet: `摘要 ${srcKey}-${id}`.repeat(5),
  };
}

function makeSource(id: string, name: string, enabled = true): InfoSource {
  return {
    _id: id,
    type: InfoSourceType.rss,
    fetcherKind: FetcherKind.rss,
    name,
    config: { url: `https://example.com/${id}.rss` },
    enabled,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

function makeInfoSourceRepo(sources: InfoSource[]): InfoSourceRepository {
  const byId = new Map(sources.map((s) => [String(s._id), s]));
  return {
    // 同步实现即可(mock 返同步值),签名上是 Promise<InfoSource[]> 但 Jest 自动包装
    findManyByIds: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(ids.map((id) => byId.get(id)).filter(Boolean)),
      ),
  } as unknown as InfoSourceRepository;
}

function makeStcRepo(sourceIds: string[] | null): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest
      .fn()
      .mockResolvedValue(sourceIds ? { sourceIds } : null),
  } as unknown as SmartTopicConfigRepository;
}

function makeFetcherRegistry(
  results: FetchManyResultPerSource[],
  spy?: jest.Mock,
): FetcherRegistry {
  const fetchManyMock = jest.fn().mockResolvedValue(results);
  return {
    fetchMany: spy ?? fetchManyMock,
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

describe('browse (v5 多源并行)', () => {
  it('Case 1: 默认无参 — 自动扫当前事项订阅的所有 enabled 源', async () => {
    const srcA = makeSource('src_a', 'A');
    const srcB = makeSource('src_b', 'B');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA, srcB]),
      smartTopicConfigRepo: makeStcRepo(['src_a', 'src_b']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'ok',
          items: [makeItem('a', 1), makeItem('a', 2)],
          durationMs: 100,
        },
        {
          source: srcB,
          status: 'ok',
          items: [makeItem('b', 1)],
          durationMs: 150,
        },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.returned).toBe(3);
    expect(result.meta.items).toHaveLength(3);
    expect(ctx.fetchedItemsMap.size).toBe(3);
    // 每条 ref 都要能反查到 sourceName
    const firstRef = result.meta.items[0].ref;
    expect(ctx.fetchedItemsMap.get(firstRef)?.sourceName).toMatch(/[AB]/);
  });

  it('Case 2: 显式 sourceIds 含 invalid + disabled → status=partial', async () => {
    const srcA = makeSource('src_a', 'A', true);
    const srcDisabled = makeSource('src_disabled', 'Disabled', false);
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA, srcDisabled]),
      smartTopicConfigRepo: makeStcRepo(null), // 不会用到
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'ok',
          items: [makeItem('a', 1)],
          durationMs: 50,
        },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(
      await run(tool, {
        sourceIds: ['src_a', 'src_disabled', 'src_nonexistent'],
      }),
    );

    expect(result.meta.status).toBe('partial');
    expect(result.meta.invalidIds).toContain('src_nonexistent');
    expect(result.meta.disabledIds).toContain('src_disabled');
    expect(result.meta.returned).toBe(1);
  });

  it('Case 3: 历史去重 — 已 pick 过的 itemGuid 剔除', async () => {
    const srcA = makeSource('src_a', 'A');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA]),
      smartTopicConfigRepo: makeStcRepo(['src_a']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'ok',
          items: [makeItem('a', 1), makeItem('a', 2), makeItem('a', 3)],
          durationMs: 50,
        },
      ]),
      pfiRepo: makePfiRepo(['guid_a_1']), // guid_a_1 已 pick 过
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.totalFetched).toBe(3);
    expect(result.meta.afterDedupe).toBe(2);
    expect(result.meta.returned).toBe(2);
  });

  it('Case 4: 单源失败 + 其他源成功 → status=partial + failedSources', async () => {
    const srcA = makeSource('src_a', 'A');
    const srcB = makeSource('src_b', 'B');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA, srcB]),
      smartTopicConfigRepo: makeStcRepo(['src_a', 'src_b']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'failed',
          items: [],
          error: 'HTTP 500',
          durationMs: 80,
        },
        {
          source: srcB,
          status: 'ok',
          items: [makeItem('b', 1), makeItem('b', 2)],
          durationMs: 120,
        },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.status).toBe('partial');
    expect(result.meta.failedSources).toHaveLength(1);
    expect(result.meta.failedSources[0].name).toBe('A');
    expect(result.meta.failedSources[0].error).toContain('HTTP 500');
    expect(result.meta.returned).toBe(2);
  });

  it('Case 5: 所有源都失败 → status=error + ALL_SOURCES_FAILED', async () => {
    const srcA = makeSource('src_a', 'A');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA]),
      smartTopicConfigRepo: makeStcRepo(['src_a']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'failed',
          items: [],
          error: 'timeout',
          durationMs: 10000,
        },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.status).toBe('error');
    expect(result.meta.errorCode).toBe('ALL_SOURCES_FAILED');
    expect(result.meta.failedSources).toHaveLength(1);
  });

  // Bug 修复回归测试:之前 `allItems===0 && failed>0` 误判成 ALL_SOURCES_FAILED,
  // 实际场景"6 源 fetch 成功但窗口内 0 条 + 1 源 SSL 失败"应该返 ok,不是 error。
  it('Case 5b: 部分源失败 + 其他源成功但 0 条 → status=ok (NOT ALL_SOURCES_FAILED)', async () => {
    const srcA = makeSource('src_a', 'A');
    const srcB = makeSource('src_b', 'B');
    const srcC = makeSource('src_c', 'C');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA, srcB, srcC]),
      smartTopicConfigRepo: makeStcRepo(['src_a', 'src_b', 'src_c']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'failed',
          items: [],
          error: 'SSL',
          durationMs: 50,
        },
        // srcB / srcC fetch 成功但窗口内 0 条(预期 — 短窗口没新发布)
        { source: srcB, status: 'ok', items: [], durationMs: 60 },
        { source: srcC, status: 'ok', items: [], durationMs: 70 },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    // 关键断言:不是 error/ALL_SOURCES_FAILED — 因为 2 源真的成功了
    expect(result.meta.errorCode).toBeUndefined();
    expect(result.meta.status).not.toBe('error');
    // 该是 partial(有失败源)
    expect(result.meta.status).toBe('partial');
    expect(result.meta.returned).toBe(0);
    expect(result.meta.failedSources).toHaveLength(1);
  });

  it('Case 6: 事项无订阅源 → NO_SUBSCRIBED_SOURCES', async () => {
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([]),
      smartTopicConfigRepo: makeStcRepo(null), // SmartTopicConfig 不存在
      fetcherRegistry: makeFetcherRegistry([]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.status).toBe('error');
    expect(result.meta.errorCode).toBe('NO_SUBSCRIBED_SOURCES');
  });

  it('Case 7: limit 参数 — 合并去重后 cap', async () => {
    const srcA = makeSource('src_a', 'A');
    const srcB = makeSource('src_b', 'B');
    const ctx = makeCtx();
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA, srcB]),
      smartTopicConfigRepo: makeStcRepo(['src_a', 'src_b']),
      fetcherRegistry: makeFetcherRegistry([
        {
          source: srcA,
          status: 'ok',
          items: [makeItem('a', 1), makeItem('a', 2), makeItem('a', 3)],
          durationMs: 50,
        },
        {
          source: srcB,
          status: 'ok',
          items: [makeItem('b', 1), makeItem('b', 2)],
          durationMs: 60,
        },
      ]),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    const result = JSON.parse(await run(tool, { limit: 3 }));
    expect(result.meta.afterDedupe).toBe(5);
    expect(result.meta.returned).toBe(3);
    expect(ctx.fetchedItemsMap.size).toBe(3);
  });

  it('Case 8: keywords 透传给 FetcherRegistry.fetchMany', async () => {
    const srcA = makeSource('src_a', 'A');
    const ctx = makeCtx();
    const fetchManySpy = jest
      .fn()
      .mockResolvedValue([
        { source: srcA, status: 'ok', items: [], durationMs: 30 },
      ]);
    const tool = createBrowseTool({
      infoSourceRepo: makeInfoSourceRepo([srcA]),
      smartTopicConfigRepo: makeStcRepo(['src_a']),
      fetcherRegistry: makeFetcherRegistry([], fetchManySpy),
      pfiRepo: makePfiRepo(),
      ctx,
    });

    await run(tool, { keywords: ['transformer', 'MoE'] });

    expect(fetchManySpy).toHaveBeenCalledTimes(1);
    expect(fetchManySpy.mock.calls[0][1]).toMatchObject({
      keywords: ['transformer', 'MoE'],
    });
  });
});
