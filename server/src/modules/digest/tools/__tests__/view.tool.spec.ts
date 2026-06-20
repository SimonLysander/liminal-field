/**
 * view (v3) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：readFull 返回内容，status:ok，chars 正确
 *   2. ref 不存在 → error ITEM_NOT_FOUND
 *   3. fetcher 不支持 readFull → status:partial，返回 snippet
 *   4. 内容超 5000 字符 → truncated:true
 */

import { createViewTool } from '../view.tool';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { TaskContext } from '../digest-tools.factory';
import type { InfoSource } from '../../info-source.entity';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import { InfoSourceType, InfoSourceCategory } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeSource(): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'HN',
    config: {},
    enabled: true,
    category: InfoSourceCategory.tech,
    createdAt: new Date(),
  };
}

function makeFetchedItem(): FetchedItem {
  return {
    itemGuid: 'guid_1',
    title: '标题 1',
    url: 'https://example.com/1',
    publishedAt: new Date('2026-06-15'),
    snippet: '摘要内容',
  };
}

function makeFetcherRegistryWithFull(fullContent?: string): FetcherRegistry {
  const readFull =
    fullContent !== undefined
      ? jest.fn().mockResolvedValue(fullContent)
      : undefined;
  return {
    get: jest.fn().mockReturnValue({
      ...(readFull ? { readFull } : {}),
    }),
  } as unknown as FetcherRegistry;
}

function makeCtx(hasSource = true, hasItem = true): TaskContext {
  const source = makeSource();
  const fetchedItem = makeFetchedItem();
  const sourceRefsMap = new Map<string, InfoSource>();
  const fetchedItemsMap = new Map<
    string,
    { fetchedItem: FetchedItem; sourceRef: string; sourceName: string }
  >();

  if (hasSource) sourceRefsMap.set('s1', source);
  if (hasItem)
    fetchedItemsMap.set('i1', {
      fetchedItem,
      sourceRef: 's1',
      sourceName: 'HN',
    });

  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 1, item: 1 },
    sourceRefsMap,
    fetchedItemsMap,
  };
}

describe('view (v3)', () => {
  it('Case 1: 正常 — readFull 返回内容，status:ok', async () => {
    const fullContent = '正文内容'.repeat(10);
    const tool = createViewTool({
      fetcherRegistry: makeFetcherRegistryWithFull(fullContent),
      ctx: makeCtx(),
    });

    const result = JSON.parse(await run(tool, { ref: 'i1' }));
    expect(result.meta.status).toBe('ok');
    expect(result.meta.chars).toBe(fullContent.length);
    expect(result.meta.truncated).toBe(false);
    expect(result.detail).toBe(fullContent);
  });

  it('Case 2: ref 不存在 → error ITEM_NOT_FOUND', async () => {
    const tool = createViewTool({
      fetcherRegistry: makeFetcherRegistryWithFull(''),
      ctx: makeCtx(true, false), // no item
    });

    const result = JSON.parse(await run(tool, { ref: 'i99' }));
    expect(result.meta.errorCode).toBe('ITEM_NOT_FOUND');
  });

  it('Case 3: 不支持 readFull → status:partial，返回 snippet', async () => {
    const tool = createViewTool({
      fetcherRegistry: makeFetcherRegistryWithFull(undefined), // no readFull
      ctx: makeCtx(),
    });

    const result = JSON.parse(await run(tool, { ref: 'i1' }));
    expect(result.meta.status).toBe('partial');
    expect(result.detail).toBe('摘要内容');
  });

  it('Case 4: 内容超 5000 字 → truncated:true，chars=5000', async () => {
    const longContent = 'x'.repeat(6000);
    const tool = createViewTool({
      fetcherRegistry: makeFetcherRegistryWithFull(longContent),
      ctx: makeCtx(),
    });

    const result = JSON.parse(await run(tool, { ref: 'i1' }));
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.chars).toBe(5000);
    expect(result.detail?.length).toBe(5000);
  });
});
