/**
 * read_item_full 工具单元测试
 *
 * 测试覆盖：
 *   1. readFull 成功 → 返回 fullContent
 *   2. fetcher 无 readFull → fallback null
 *   3. readFull 抛错 → fallback null（不传错给 LLM）
 */
import { createReadItemFullTool } from '../read-item-full.tool';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { InfoSource } from '../../info-source.entity';
import { InfoSourceType } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeSource(): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'Tech Feed',
    config: { url: 'https://example.com/feed' },
    enabled: true,
    createdAt: new Date(),
  };
}

function makeInfoSourceRepo(source: InfoSource | null): InfoSourceRepository {
  return {
    findById: jest.fn().mockResolvedValue(source),
  } as unknown as InfoSourceRepository;
}

function makeRegistry(readFullFn?: jest.Mock): FetcherRegistry {
  const fetcher: Record<string, unknown> = {
    type: InfoSourceType.rss,
    fetch: jest.fn(),
  };
  if (readFullFn) fetcher.readFull = readFullFn;
  return {
    get: jest.fn().mockReturnValue(fetcher),
  } as unknown as FetcherRegistry;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('read_item_full tool', () => {
  it('Case 1: readFull 成功 → status:ok，detail 含全文', async () => {
    const fullContent = '这是文章的完整正文内容，非常长...';
    const readFullFn = jest.fn().mockResolvedValue(fullContent);
    const tool = createReadItemFullTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(readFullFn),
    });

    const result = await run(tool, {
      sourceId: 'src_001',
      itemGuid: 'guid-001',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.charCount).toBe(fullContent.length);
    // 全文在 detail 给模型，不在 meta
    expect(parsed.detail).toContain('这是文章的完整正文内容');
    expect(readFullFn).toHaveBeenCalledWith(expect.any(Object), 'guid-001');
  });

  it('Case 2: fetcher 无 readFull → status:partial，fullContent:null，hint 提示', async () => {
    const tool = createReadItemFullTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(undefined), // 不挂 readFull
    });

    const result = await run(tool, {
      sourceId: 'src_001',
      itemGuid: 'guid-001',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('partial');
    expect(parsed.meta.fullContent).toBeNull();
    expect(parsed.meta.hint).toBe('full content not available, use snippet instead');
  });

  it('Case 3: readFull 抛错 → status:partial，优雅退化，fullContent:null', async () => {
    const readFullFn = jest
      .fn()
      .mockRejectedValue(new Error('no content:encoded'));
    const tool = createReadItemFullTool({
      infoSourceRepo: makeInfoSourceRepo(makeSource()),
      fetcherRegistry: makeRegistry(readFullFn),
    });

    const result = await run(tool, {
      sourceId: 'src_001',
      itemGuid: 'guid-001',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('partial');
    expect(parsed.meta.fullContent).toBeNull();
    expect(parsed.meta.hint).toBe('full content not available, use snippet instead');
  });
});
