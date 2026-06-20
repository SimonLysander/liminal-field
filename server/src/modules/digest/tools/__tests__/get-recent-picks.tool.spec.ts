/**
 * get_recent_picks 工具单元测试
 *
 * 测试覆盖：
 *   1. 有历史记录 → 返回 picks 列表（含 pickedAt ISO 字符串）
 *   2. 无历史记录 → ok + total:0
 */
import { createGetRecentPicksTool } from '../get-recent-picks.tool';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { ProcessedFeedItem } from '../../processed-feed-item.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

// ── Mocks ─────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-18T08:00:00Z');

function makePfi(
  overrides: Partial<ProcessedFeedItem> = {},
): ProcessedFeedItem {
  return {
    _id: 'pfi_001',
    topicId: 'ci_topic001',
    sourceId: 'src_001',
    itemGuid: 'guid-001',
    title: 'Recent Article',
    url: 'https://example.com/recent',
    pickedAt: NOW,
    reportContentItemId: 'ci_report001',
    ...overrides,
  };
}

function makeRepo(items: ProcessedFeedItem[]): ProcessedFeedItemRepository {
  return {
    findRecentByTopic: jest.fn().mockResolvedValue(items),
  } as unknown as ProcessedFeedItemRepository;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('get_recent_picks tool', () => {
  it('Case 1: 有历史记录 → 返回正确 picks 格式（pickedAt 为 ISO 字符串）', async () => {
    const pfi = makePfi();
    const repo = makeRepo([pfi]);
    const tool = createGetRecentPicksTool({ pfiRepo: repo });

    const result = await run(tool, {
      topicId: 'ci_topic001',
      days: 14,
      limit: 20,
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(1);
    expect(parsed.meta.picks).toHaveLength(1);
    expect(parsed.meta.picks[0].itemGuid).toBe('guid-001');
    expect(parsed.meta.picks[0].pickedAt).toBe(NOW.toISOString());
    expect(repo.findRecentByTopic).toHaveBeenCalledWith('ci_topic001', 14, 20);
  });

  it('Case 2: 无历史记录 → ok + total:0', async () => {
    const repo = makeRepo([]);
    const tool = createGetRecentPicksTool({ pfiRepo: repo });

    const result = await run(tool, {
      topicId: 'ci_topic001',
      days: 7,
      limit: 10,
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(0);
  });
});
