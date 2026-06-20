/**
 * pick (v3) 工具单元测试
 *
 * 覆盖：
 *   1. 正常：保存 2 条 findings，citationId 正确递增，pickedRefs 正确
 *   2. 所有 ref 无效 → error ALL_REFS_INVALID
 *   3. 部分 ref 无效 → status:partial，skippedRefs 非空
 */

import { createPickTool } from '../pick.tool';
import type { DigestTaskRepository } from '../../digest-task.repository';
import type { TaskContext } from '../digest-tools.factory';
import type { FetchedItem } from '../../fetchers/fetcher.interface';
import type { DigestTask } from '../../digest-task.entity';

const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

function makeFetchedItem(id: number): FetchedItem {
  return {
    itemGuid: `guid_${id}`,
    title: `标题 ${id}`,
    url: `https://example.com/${id}`,
    publishedAt: new Date('2026-06-15'),
    snippet: `摘要 ${id}`,
  };
}

function makeTask(existingFindingsCount: number): DigestTask {
  return {
    _id: 'dt_test',
    findings: Array.from({ length: existingFindingsCount }, (_, i) => ({
      citationId: i + 1,
      sourceId: 'src_001',
      sourceName: 'HN',
      itemGuid: `existing_${i}`,
      title: `已有 ${i}`,
      url: `https://example.com/existing_${i}`,
      snippet: '已有摘要',
      reason: '已有',
    })),
  } as DigestTask;
}

function makeTaskRepo(task: DigestTask): DigestTaskRepository {
  return {
    findById: jest.fn().mockResolvedValue(task),
    appendFindings: jest.fn().mockResolvedValue(undefined),
  } as unknown as DigestTaskRepository;
}

function makeCtx(itemRefs: Record<string, number> = {}): TaskContext {
  const fetchedItemsMap = new Map<
    string,
    { fetchedItem: FetchedItem; sourceRef: string; sourceName: string }
  >();
  for (const [ref, id] of Object.entries(itemRefs)) {
    fetchedItemsMap.set(ref, {
      fetchedItem: makeFetchedItem(id),
      sourceRef: 's1',
      sourceName: 'HN',
    });
  }
  return {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 1, item: Object.keys(itemRefs).length },
    sourceRefsMap: new Map(),
    fetchedItemsMap,
  };
}

describe('pick (v3)', () => {
  it('Case 1: 正常 — 保存 2 条，citationId 从已有数量+1 开始', async () => {
    const taskRepo = makeTaskRepo(makeTask(2)); // 已有 2 条
    const ctx = makeCtx({ i1: 1, i2: 2 });
    const tool = createPickTool({ taskRepo, ctx });

    const result = JSON.parse(
      await run(tool, {
        items: [
          { ref: 'i1', reason: '相关' },
          { ref: 'i2', reason: '含数据' },
        ],
      }),
    );

    expect(result.meta.status).toBe('ok');
    expect(result.meta.saved).toBe(2);
    expect(result.meta.skipped).toBe(0);
    expect(result.meta.citationIds).toEqual([3, 4]); // 从 2+1=3 开始
    expect(taskRepo.appendFindings).toHaveBeenCalledTimes(1);
  });

  it('Case 2: 所有 ref 无效 → error ALL_REFS_INVALID', async () => {
    const taskRepo = makeTaskRepo(makeTask(0));
    const ctx = makeCtx({}); // 空 fetchedItemsMap
    const tool = createPickTool({ taskRepo, ctx });

    const result = JSON.parse(
      await run(tool, {
        items: [{ ref: 'i99', reason: '不存在' }],
      }),
    );

    expect(result.meta.errorCode).toBe('ALL_REFS_INVALID');
    expect(taskRepo.appendFindings).not.toHaveBeenCalled();
  });

  it('Case 3: 部分 ref 无效 → status:partial，skippedRefs 包含无效 ref', async () => {
    const taskRepo = makeTaskRepo(makeTask(0));
    const ctx = makeCtx({ i1: 1 }); // 只有 i1，i2 不存在
    const tool = createPickTool({ taskRepo, ctx });

    const result = JSON.parse(
      await run(tool, {
        items: [
          { ref: 'i1', reason: '相关' },
          { ref: 'i2', reason: '不存在' },
        ],
      }),
    );

    expect(result.meta.status).toBe('partial');
    expect(result.meta.saved).toBe(1);
    expect(result.meta.skipped).toBe(1);
    expect(result.meta.skippedRefs).toContain('i2');
  });
});
