import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLearningData } from '../useLearningData';
import { notesApi } from '@/services/workspace';
import { structureApi } from '@/services/structure';
import { learningApi, type LearningProjectOutline } from '@/services/learning';

vi.mock('@/services/learning', () => ({ learningApi: { outline: vi.fn() } }));

vi.mock('@/services/structure', () => ({
  structureApi: {
    getChildren: vi.fn(),
    getPathByNodeId: vi.fn(),
    createNode: vi.fn(),
    deleteNode: vi.fn(),
    reorderSiblings: vi.fn(),
  },
}));

vi.mock('@/services/workspace', () => ({
  notesApi: {
    aidraftsExist: vi.fn(),
    getLearnPlan: vi.fn(),
  },
}));

vi.mock('@/components/ui/banner-api', () => ({
  banner: { error: vi.fn() },
}));

const plan = (goal: string) => ({
  goal,
  understanding: '第一段。\n\n第二段。\n\n第三段。',
  items: [],
  conclusion: '结论。',
});

function outline(entries: Array<[string, number, boolean]> = []): LearningProjectOutline {
  const node = (id: string) => ({
    id, name: id, contentItemId: `ci-${id}`, type: 'DOC' as const,
    sortOrder: 0, hasChildren: false, createdAt: '2026-01-01T00:00:00Z',
  });
  return {
    rootNode: { ...node('topic-nav'), name: '摄影', contentItemId: 'topic-ci' },
    chapters: entries.map(([id, depth, isIndependentLearningRoot]) => ({
      node: node(id), depth, isIndependentLearningRoot,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useLearningData', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(learningApi.outline).mockResolvedValue(outline());
    vi.mocked(notesApi.aidraftsExist).mockResolvedValue({ ids: [] });
  });

  it('keeps the learning page available when only the plan request fails', async () => {
    vi.mocked(notesApi.getLearnPlan).mockRejectedValue(new Error('规划服务暂时不可用'));

    const { result } = renderHook(() => useLearningData('topic-nav'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.plan).toBeNull();
    expect(result.current.planError).toBe('规划服务暂时不可用');
    expect(learningApi.outline).toHaveBeenCalledTimes(1);
    expect(structureApi.getChildren).not.toHaveBeenCalled();
  });

  it('ignores an older refresh response that arrives after a newer one', async () => {
    vi.mocked(notesApi.getLearnPlan).mockResolvedValueOnce(plan('初始规划'));
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.plan?.goal).toBe('初始规划'));

    const older = deferred<ReturnType<typeof plan>>();
    const newer = deferred<ReturnType<typeof plan>>();
    vi.mocked(notesApi.getLearnPlan)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderRefresh!: Promise<void>;
    let newerRefresh!: Promise<void>;
    act(() => {
      olderRefresh = result.current.refreshPlan();
      newerRefresh = result.current.refreshPlan();
    });
    await act(async () => {
      newer.resolve(plan('新规划'));
      await newerRefresh;
    });
    await act(async () => {
      older.resolve(plan('旧规划'));
      await olderRefresh;
    });

    expect(result.current.plan?.goal).toBe('新规划');
  });

  it('keeps independent learning entries but excludes their plans from studied probes', async () => {
    vi.mocked(learningApi.outline).mockResolvedValue(outline([
      ['owned', 0, false], ['nested', 0, true],
    ]));
    vi.mocked(notesApi.aidraftsExist).mockResolvedValue({ ids: ['ci-owned', 'ci-nested'] });
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(notesApi.aidraftsExist).toHaveBeenCalledWith(['ci-owned']);
    expect(result.current.allChapters.map((chapter) => [chapter.navId, chapter.studied, chapter.isIndependentLearningRoot])).toEqual([
      ['owned', true, false], ['nested', false, true],
    ]);
  });

  it('reloads the whole directory after deleting a subtree', async () => {
    vi.mocked(learningApi.outline).mockResolvedValueOnce(outline([
      ['removed', 0, false], ['leaf', 1, false], ['remaining', 0, false],
    ])).mockResolvedValue(outline([['remaining', 0, false]]));
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.removeChapter('removed'));
    expect(structureApi.deleteNode).toHaveBeenCalledWith('removed');
    expect(result.current.chapters.map((chapter) => chapter.navId)).toEqual(['remaining']);
    expect(result.current.allChapters.map((chapter) => chapter.navId)).toEqual(['remaining']);
  });

  it('keeps both navigation lists unchanged and propagates deletion failure', async () => {
    vi.mocked(learningApi.outline).mockResolvedValue(outline([['owned', 0, false]]));
    vi.mocked(structureApi.deleteNode).mockRejectedValue(new Error('已发布，请先取消发布'));
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.removeChapter('owned')).rejects.toThrow('已发布');
    });
    expect(result.current.allChapters.map((chapter) => chapter.navId)).toEqual(['owned']);
    expect(result.current.chapters.map((chapter) => chapter.navId)).toEqual(['owned']);
    expect(learningApi.outline).toHaveBeenCalledTimes(1);
  });

  it('uses server ordering for both chapters and nested navigation after sorting', async () => {
    vi.mocked(learningApi.outline).mockResolvedValueOnce(outline([
      ['a', 0, false], ['a-leaf', 1, false], ['b', 0, false],
    ])).mockResolvedValue(outline([
      ['b', 0, false], ['a', 0, false], ['a-leaf', 1, false],
    ]));
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.reorderChapters(['b', 'a']));
    expect(structureApi.reorderSiblings).toHaveBeenCalledWith('topic-nav', ['b', 'a']);
    expect(result.current.chapters.map((chapter) => chapter.navId)).toEqual(['b', 'a']);
    expect(result.current.allChapters.map((chapter) => chapter.navId)).toEqual(['b', 'a', 'a-leaf']);
  });

  it('reports directory refresh failure after a successful delete rather than claiming deletion failed', async () => {
    vi.mocked(learningApi.outline).mockResolvedValueOnce(outline([['owned', 0, false]])).mockRejectedValue(new Error('目录读取失败'));
    const { result } = renderHook(() => useLearningData('topic-nav'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.removeChapter('owned'));
    expect(result.current.error).toBe('目录读取失败');
    expect(structureApi.deleteNode).toHaveBeenCalledTimes(1);
  });
});
