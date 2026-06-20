/**
 * list_sources (v3) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：返回 sources 列表，分配 ref s1/s2，写入 sourceRefsMap
 *   2. 事项无订阅信息源 → not_found
 *   3. stcRepo 返回 null（事项不存在）→ not_found
 */

import { createListSourcesTool } from '../list-sources.tool';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { InfoSource } from '../../info-source.entity';
import type { SmartTopicConfig } from '../../smart-topic-config.entity';
import type { TaskContext } from '../digest-tools.factory';
import { InfoSourceType } from '../../info-source.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeCtx(overrides?: Partial<TaskContext>): TaskContext {
  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 0, item: 0 },
    sourceRefsMap: new Map(),
    fetchedItemsMap: new Map(),
    ...overrides,
  };
}

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

function makeSource(id: string, name: string): InfoSource {
  return {
    _id: id,
    type: InfoSourceType.rss,
    name,
    config: { url: `https://example.com/feed/${id}` },
    enabled: true,
    createdAt: new Date(),
  };
}

function makeConfig(sourceIds: string[]): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    sourceIds,
    cron: '0 8 * * *',
    keywords: [],
    prompt: '测试',
    enabled: true,
    extractFields: [],
    topN: 10,
    createdAt: new Date(),
  };
}

describe('list_sources (v3)', () => {
  it('Case 1: 正常 — 分配 ref s1/s2，写入 sourceRefsMap', async () => {
    const ctx = makeCtx();
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([
        makeSource('src_001', 'HN'),
        makeSource('src_002', 'Reddit'),
      ]),
      stcRepo: makeStcRepo(makeConfig(['src_001', 'src_002'])),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.sources).toHaveLength(2);
    expect(result.meta.sources[0].ref).toBe('s1');
    expect(result.meta.sources[1].ref).toBe('s2');
    expect(ctx.sourceRefsMap.size).toBe(2);
    expect(ctx.sourceRefsMap.has('s1')).toBe(true);
    expect(ctx.sourceRefsMap.get('s1')?.name).toBe('HN');
  });

  it('Case 2: 无订阅源 → not_found', async () => {
    const ctx = makeCtx();
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([]),
      stcRepo: makeStcRepo(makeConfig([])),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.status).toBe('not_found');
  });

  it('Case 3: stcRepo 返回 null → not_found', async () => {
    const ctx = makeCtx();
    const tool = createListSourcesTool({
      infoSourceRepo: makeInfoSourceRepo([]),
      stcRepo: makeStcRepo(null),
      ctx,
    });

    const result = JSON.parse(await run(tool, {}));
    expect(result.meta.status).toBe('not_found');
  });
});
