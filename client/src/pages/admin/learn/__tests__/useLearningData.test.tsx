import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLearningData } from '../useLearningData';
import { notesApi } from '@/services/workspace';
import { structureApi } from '@/services/structure';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useLearningData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(structureApi.getChildren).mockResolvedValue({
      path: [{ id: 'topic-nav', name: '摄影', contentItemId: 'topic-ci' }],
      children: [],
    } as never);
    vi.mocked(notesApi.aidraftsExist).mockResolvedValue({ ids: [] });
  });

  it('keeps the learning page available when only the plan request fails', async () => {
    vi.mocked(notesApi.getLearnPlan).mockRejectedValue(new Error('规划服务暂时不可用'));

    const { result } = renderHook(() => useLearningData('topic-nav'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.plan).toBeNull();
    expect(result.current.planError).toBe('规划服务暂时不可用');
    expect(structureApi.getChildren).toHaveBeenCalledTimes(1);
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
});
