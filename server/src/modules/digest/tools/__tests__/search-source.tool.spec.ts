/**
 * search_source 工具单元测试
 *
 * 测试覆盖：
 *   1. fetcher.search 存在 → 成功搜索返回命中
 *   2. fetcher.search 为 undefined → 返回 error 提示
 *   3. 搜索无结果 → ok + total:0
 */
import { createSearchSourceTool } from '../search-source.tool';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { InfoSource } from '../../info-source.entity';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import { InfoSourceType } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

// ── Mocks ─────────────────────────────────────────────────────────────────────

const ITEM: FetchedItem = {
  itemGuid: 'guid-002',
  title: 'AI 相关文章',
  url: 'https://example.com/ai',
  snippet: 'AI 改变了世界',
};

function makeSource(enabled = true): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'RSS Feed',
    config: { url: 'https://example.com/feed' },
    enabled,
    createdAt: new Date(),
  };
}

function makeInfoSourceRepo(source: InfoSource | null): InfoSourceRepository {
  return {
    findById: jest.fn().mockResolvedValue(source),
  } as unknown as InfoSourceRepository;
}

function makeRegistry(searchFn?: jest.Mock): FetcherRegistry {
  const fetcher: Record<string, unknown> = {
    type: InfoSourceType.rss,
    fetch: jest.fn(),
  };
  if (searchFn) fetcher.search = searchFn;
  // 无 searchFn 时不挂 search 属性 → typeof === 'undefined'
  return {
    get: jest.fn().mockReturnValue(fetcher),
  } as unknown as FetcherRegistry;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('search_source tool', () => {
  it('Case 1: fetcher.search 存在 → 成功返回命中条目', async () => {
    const onItems = jest.fn();
    const searchFn = jest.fn().mockResolvedValue([ITEM]);
    const tool = createSearchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(searchFn),
      onItems,
    });

    const result = await run(tool, {
      sourceId: 'src_001',
      query: 'AI',
      limit: 10,
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(1);
    expect(parsed.meta.items[0].itemGuid).toBe('guid-002');
    expect(onItems).toHaveBeenCalledWith([ITEM]);
  });

  it('Case 2: fetcher.search 为 undefined → invalid（源不支持该能力）', async () => {
    const tool = createSearchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(undefined), // 不挂 search
      onItems: jest.fn(),
    });

    const result = await run(tool, { sourceId: 'src_001', query: '关键词' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('invalid');
    expect(parsed.summary).toContain('不支持搜索');
  });

  it('Case 3: 搜索无命中 → not_found + total:0', async () => {
    const searchFn = jest.fn().mockResolvedValue([]);
    const tool = createSearchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(searchFn),
      onItems: jest.fn(),
    });

    const result = await run(tool, {
      sourceId: 'src_001',
      query: '不存在的话题',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('not_found');
    expect(parsed.meta.total).toBe(0);
  });
});
