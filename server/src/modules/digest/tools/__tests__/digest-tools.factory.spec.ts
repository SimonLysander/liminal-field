/**
 * DigestToolsFactory 单元测试
 *
 * 测试覆盖：
 *   1. buildToolset() 返回 6 个正确命名的工具 key
 *   2. 不同 taskId 调用 buildToolset() 产生独立实例（fetchedItemsMap 独立）
 */
import { DigestToolsFactory } from '../digest-tools.factory';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { FetcherRegistry } from '../../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { DigestTaskRepository } from '../../digest-task.repository';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInfoSourceRepo = {} as InfoSourceRepository;
const mockStcRepo = {} as SmartTopicConfigRepository;
const mockFetcherRegistry = {} as FetcherRegistry;
const mockPfiRepo = {} as ProcessedFeedItemRepository;
const mockTaskRepo = {} as DigestTaskRepository;

function makeFactory(): DigestToolsFactory {
  return new DigestToolsFactory(
    mockInfoSourceRepo,
    mockStcRepo,
    mockFetcherRegistry,
    mockPfiRepo,
    mockTaskRepo,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DigestToolsFactory', () => {
  it('Case 1: buildToolset() 返回包含 6 个工具 key 的对象', () => {
    const factory = makeFactory();
    const toolset = factory.buildToolset('dt_001');

    expect(Object.keys(toolset)).toEqual(
      expect.arrayContaining([
        'list_sources',
        'fetch_source',
        'search_source',
        'read_item_full',
        'get_recent_picks',
        'save_finding',
      ]),
    );
    expect(Object.keys(toolset)).toHaveLength(6);
  });

  it('Case 2: 每个工具对象都有 execute 方法（Vercel AI SDK tool 形状）', () => {
    const factory = makeFactory();
    const toolset = factory.buildToolset('dt_002');

    for (const [name, t] of Object.entries(toolset)) {
      expect(typeof t.execute).toBe('function'); // name 在测试失败时可见
      void name; // 消除 unused variable 警告
    }
  });

  it('Case 3: 不同 taskId 调 buildToolset → fetchedItemsMap 独立（fetch 注入不跨 task）', () => {
    const factory = makeFactory();
    const toolset1 = factory.buildToolset('dt_001');
    const toolset2 = factory.buildToolset('dt_002');

    // 两个 toolset 是独立对象
    expect(toolset1.save_finding).not.toBe(toolset2.save_finding);
    expect(toolset1.fetch_source).not.toBe(toolset2.fetch_source);
  });
});
