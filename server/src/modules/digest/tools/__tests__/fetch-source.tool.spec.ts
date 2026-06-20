/**
 * fetch_source 工具单元测试
 *
 * 测试覆盖：
 *   1. 成功 fetch → 返回 items + onItems 被调用
 *   2. 源不存在 → not_found
 *   3. 源已禁用 → error
 */
import { createFetchSourceTool } from '../fetch-source.tool';
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
  itemGuid: 'guid-001',
  title: 'Test Article',
  url: 'https://example.com/1',
  publishedAt: new Date('2026-06-18T00:00:00Z'),
  snippet: '这是摘要内容',
};

function makeSource(overrides: Partial<InfoSource> = {}): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'Tech Feed',
    config: { url: 'https://example.com/feed' },
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeInfoSourceRepo(source: InfoSource | null): InfoSourceRepository {
  return {
    findById: jest.fn().mockResolvedValue(source),
  } as unknown as InfoSourceRepository;
}

function makeFetcherRegistry(fetchFn: jest.Mock): FetcherRegistry {
  const fetcher = { type: InfoSourceType.rss, fetch: fetchFn };
  return {
    get: jest.fn().mockReturnValue(fetcher),
  } as unknown as FetcherRegistry;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('fetch_source tool', () => {
  it('Case 1: 成功 fetch → 返回 items，onItems 被调用', async () => {
    const onItems = jest.fn();
    const fetchFn = jest.fn().mockResolvedValue([ITEM]);
    const tool = createFetchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeFetcherRegistry(fetchFn),
      onItems,
    });

    const result = await run(tool, { sourceId: 'src_001', limit: 10 });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(1);
    expect(parsed.meta.items[0].itemGuid).toBe('guid-001');
    expect(onItems).toHaveBeenCalledWith([ITEM]);
  });

  it('Case 2: 源不存在 → status not_found', async () => {
    const tool = createFetchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(null),
      fetcherRegistry: makeFetcherRegistry(jest.fn()),
      onItems: jest.fn(),
    });

    const result = await run(tool, { sourceId: 'src_ghost' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('not_found');
  });

  it('Case 3: 源已禁用 → invalid（输入指向无效源，非系统错误）', async () => {
    const disabledSource = makeSource({ enabled: false });
    const tool = createFetchSourceTool({
      infoSourceRepo: makeInfoSourceRepo(disabledSource),
      fetcherRegistry: makeFetcherRegistry(jest.fn()),
      onItems: jest.fn(),
    });

    const result = await run(tool, { sourceId: 'src_001' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('invalid');
    expect(parsed.summary).toContain('禁用');
  });
});
