/**
 * save_finding 工具单元测试
 *
 * 测试覆盖：
 *   1. itemGuid 在 fetchedItemsMap 中 → 保存成功，appendFindings 被调用
 *   2. itemGuid 不在 fetchedItemsMap → 跳过，saved=0 skipped=1
 *   3. 任务不存在 → error
 *   4. 混合 guid（部分存在部分不存在）→ 只保存存在的
 */
import { createSaveFindingTool } from '../save-finding.tool';
import type { DigestTaskRepository } from '../../digest-task.repository';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import type { DigestTask } from '../../digest-task.entity';
import { DigestTaskStatus } from '../../digest-task.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

// ── Mocks ─────────────────────────────────────────────────────────────────────

const ITEM: FetchedItem = {
  itemGuid: 'guid-001',
  title: 'Article One',
  url: 'https://example.com/1',
  publishedAt: new Date('2026-06-18T00:00:00Z'),
  snippet: '摘要内容',
};

function makeTaskRepo(
  findings: DigestTask['findings'] = [],
): DigestTaskRepository {
  const task: Partial<DigestTask> = {
    _id: 'dt_001',
    topicId: 'ci_topic001',
    status: DigestTaskStatus.running,
    findings,
  };
  return {
    findById: jest.fn().mockResolvedValue(task),
    appendFindings: jest.fn().mockResolvedValue(undefined),
  } as unknown as DigestTaskRepository;
}

function makeInfoSourceRepo(): InfoSourceRepository {
  return {
    findById: jest.fn().mockResolvedValue({ _id: 'src_001', name: 'RSS Feed' }),
  } as unknown as InfoSourceRepository;
}

function makeTool(
  fetchedItems: FetchedItem[],
  taskFindings: DigestTask['findings'] = [],
  taskExists = true,
) {
  const fetchedItemsMap = new Map<string, FetchedItem>();
  for (const it of fetchedItems) {
    fetchedItemsMap.set(it.itemGuid, it);
  }

  const taskRepo: DigestTaskRepository = taskExists
    ? makeTaskRepo(taskFindings)
    : ({
        findById: jest.fn().mockResolvedValue(null),
        appendFindings: jest.fn(),
      } as unknown as DigestTaskRepository);

  return {
    tool: createSaveFindingTool({
      taskRepo,
      infoSourceRepo: makeInfoSourceRepo(),
      taskContext: { taskId: 'dt_001', fetchedItemsMap },
    }),
    taskRepo,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('save_finding tool', () => {
  it('Case 1: itemGuid 在 map 中 → 保存成功，appendFindings 被调用', async () => {
    const { tool, taskRepo } = makeTool([ITEM]);

    const result = await run(tool, {
      itemGuids: ['guid-001'],
      sourceId: 'src_001',
      reason: '内容高度相关',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('ok');
    expect(parsed.meta.saved).toBe(1);
    expect(parsed.meta.skipped).toBe(0);
    expect(taskRepo.appendFindings).toHaveBeenCalledWith(
      'dt_001',
      expect.arrayContaining([
        expect.objectContaining({
          citationId: 1,
          itemGuid: 'guid-001',
          title: 'Article One',
          reason: '内容高度相关',
        }),
      ]),
    );
  });

  it('Case 2: itemGuid 不在 map → status:partial，saved=0 skipped=1，skippedGuids 在 meta', async () => {
    const { tool, taskRepo } = makeTool([]); // map 为空

    const result = await run(tool, {
      itemGuids: ['guid-ghost'],
      sourceId: 'src_001',
      reason: '试图引用不存在的',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('partial');
    expect(parsed.meta.saved).toBe(0);
    expect(parsed.meta.skipped).toBe(1);
    expect(parsed.meta.skippedGuids).toContain('guid-ghost');
    expect(taskRepo.appendFindings).not.toHaveBeenCalled();
  });

  it('Case 3: 任务不存在 → error', async () => {
    const { tool } = makeTool([], [], false);

    const result = await run(tool, {
      itemGuids: ['guid-001'],
      sourceId: 'src_001',
      reason: '相关',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.status).toBe('error');
    expect(parsed.summary).toContain('不存在');
  });

  it('Case 4: 混合 guid（1 存在 1 不存在）→ 只保存存在的', async () => {
    const { tool, taskRepo } = makeTool([ITEM]);

    const result = await run(tool, {
      itemGuids: ['guid-001', 'guid-ghost'],
      sourceId: 'src_001',
      reason: '部分相关',
    });
    const parsed = JSON.parse(result);

    expect(parsed.meta.saved).toBe(1);
    expect(parsed.meta.skipped).toBe(1);
    expect(taskRepo.appendFindings).toHaveBeenCalledWith(
      'dt_001',
      expect.arrayContaining([
        expect.objectContaining({ itemGuid: 'guid-001' }),
      ]),
    );
  });
});
