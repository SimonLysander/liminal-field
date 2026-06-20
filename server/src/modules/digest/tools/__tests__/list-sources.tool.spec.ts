/**
 * list_sources 工具单元测试
 *
 * 测试覆盖：
 *   1. 正常返回 sources 列表（包含 capabilities）
 *   2. 事项配置不存在 → not_found
 *   3. 事项无订阅信息源 → ok + total:0
 */
import { createListSourcesTool } from '../list-sources.tool';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { InfoSource } from '../../info-source.entity';
import type { SmartTopicConfig } from '../../smart-topic-config.entity';
import { InfoSourceType } from '../../info-source.entity';

// execute 在 AI SDK Tool 类型上是可选的，统一用 helper 绕过类型检查
const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeInfoSourceRepo(sources: InfoSource[]): InfoSourceRepository {
  return {
    findManyByIds: jest.fn().mockResolvedValue(sources),
  } as unknown as InfoSourceRepository;
}

function makeStcRepo(
  config: SmartTopicConfig | null,
): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue(config),
  } as unknown as SmartTopicConfigRepository;
}

function makeSource(overrides: Partial<InfoSource> = {}): InfoSource {
  return {
    _id: 'src_001',
    type: InfoSourceType.rss,
    name: 'Test RSS',
    config: { url: 'https://example.com/feed' },
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<SmartTopicConfig> = {},
): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    sourceIds: ['src_001'],
    cron: '0 8 * * *',
    keywords: [],
    prompt: '科技新闻',
    enabled: true,
    extractFields: [],
    topN: 10,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('list_sources tool', () => {
  it('Case 1: 正常返回 sources 列表，包含 capabilities', async () => {
    const source = makeSource();
    const config = makeConfig({ sourceIds: ['src_001'] });
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([source]),
      stcRepo: makeStcRepo(config),
    });

    const result = await run(tool, { topicId: 'ci_topic001' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(1);
    expect(parsed.meta.sources).toHaveLength(1);
    expect(parsed.meta.sources[0].id).toBe('src_001');
    expect(parsed.meta.sources[0].capabilities).toContain('fetch');
    expect(parsed.meta.sources[0].capabilities).toContain('search');
    expect(parsed.meta.sources[0].capabilities).toContain('read_full');
  });

  it('Case 2: 事项配置不存在 → status not_found', async () => {
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([]),
      stcRepo: makeStcRepo(null),
    });

    const result = await run(tool, { topicId: 'ci_nonexistent' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('not_found');
  });

  it('Case 3: 事项无订阅信息源 → ok + total:0', async () => {
    const config = makeConfig({ sourceIds: [] });
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([]),
      stcRepo: makeStcRepo(config),
    });

    const result = await run(tool, { topicId: 'ci_topic001' });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.total).toBe(0);
  });
});
