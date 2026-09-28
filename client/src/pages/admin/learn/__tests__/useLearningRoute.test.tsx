import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLearningUrl, learningApi, type LearningProjectResolve } from '@/services/learning';
import { structureApi, type StructureNode } from '@/services/structure';
import { useLearningRoute } from '../useLearningRoute';

vi.mock('@/services/learning', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/learning')>(),
  learningApi: { resolve: vi.fn() },
}));
vi.mock('@/services/structure', () => ({
  structureApi: { getPathByContentItemId: vi.fn() },
}));

function node(id: string): StructureNode {
  return {
    id, name: id, type: 'DOC', contentItemId: `ci_${id}`,
    sortOrder: 0, hasChildren: false, createdAt: '2026-09-28T00:00:00Z',
  };
}

function resolved(root: string, current: string, path: string[]): LearningProjectResolve {
  return {
    project: { id: `p_${root}`, rootNodeId: root, rootContentItemId: `ci_${root}`, status: 'active' },
    canStart: false, rootNode: node(root), currentNode: node(current), path: path.map(node),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('useLearningRoute', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each([
    ['child', ['parent', 'child'], '/admin/notes/child/learn'],
    ['leaf', ['parent', 'child', 'leaf'], '/admin/notes/child/learn?node=ci_leaf'],
  ])('routes the nested %s page to its own nearest learning project', async (current, path, url) => {
    vi.mocked(structureApi.getPathByContentItemId).mockResolvedValue((path as string[]).map(node));
    vi.mocked(learningApi.resolve).mockResolvedValue(resolved('child', current as string, path as string[]));
    const { result } = renderHook(() => useLearningRoute('parent', `ci_${current}`));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(buildLearningUrl(result.current.resolved!)).toBe(url);
    expect(learningApi.resolve).toHaveBeenCalledWith(current);
  });

  it('resolves the topic itself without requesting a content path', async () => {
    vi.mocked(learningApi.resolve).mockResolvedValue(resolved('parent', 'parent', ['parent']));
    const { result } = renderHook(() => useLearningRoute('parent', null));
    await waitFor(() => expect(result.current.resolved?.rootNode.id).toBe('parent'));
    expect(structureApi.getPathByContentItemId).not.toHaveBeenCalled();
  });

  it('immediately hides the previous role and ignores late responses after navigation', async () => {
    vi.mocked(learningApi.resolve).mockResolvedValueOnce(resolved('parent', 'parent', ['parent']));
    const { result, rerender } = renderHook(({ cid }) => useLearningRoute('parent', cid), {
      initialProps: { cid: null as string | null },
    });
    await waitFor(() => expect(result.current.resolved?.currentNode.id).toBe('parent'));

    const oldPath = deferred<StructureNode[]>();
    vi.mocked(structureApi.getPathByContentItemId)
      .mockReturnValueOnce(oldPath.promise)
      .mockResolvedValueOnce([node('parent'), node('new')]);
    vi.mocked(learningApi.resolve).mockResolvedValue(resolved('parent', 'new', ['parent', 'new']));
    rerender({ cid: 'ci_old' });
    expect(result.current.resolved).toBeNull();
    expect(result.current.loading).toBe(true);
    rerender({ cid: 'ci_new' });
    await waitFor(() => expect(result.current.resolved?.currentNode.id).toBe('new'));
    await act(async () => { oldPath.resolve([node('parent'), node('old')]); });
    expect(result.current.resolved?.currentNode.id).toBe('new');
  });

  it('rejects unrelated node queries rather than treating them as a plan page', async () => {
    vi.mocked(structureApi.getPathByContentItemId).mockResolvedValue([node('unrelated')]);
    const { result } = renderHook(() => useLearningRoute('parent', 'ci_unrelated'));
    await waitFor(() => expect(result.current.error).toContain('不在当前学习目录'));
    expect(result.current.resolved).toBeNull();
    expect(learningApi.resolve).not.toHaveBeenCalled();
  });

  it('rejects a page moved out of the directory between the two reads', async () => {
    vi.mocked(structureApi.getPathByContentItemId).mockResolvedValue([node('parent'), node('leaf')]);
    vi.mocked(learningApi.resolve).mockResolvedValue(resolved('other', 'leaf', ['other', 'leaf']));
    const { result } = renderHook(() => useLearningRoute('parent', 'ci_leaf'));
    await waitFor(() => expect(result.current.error).toContain('不在当前学习目录'));
    expect(result.current.resolved).toBeNull();
  });

  it('blocks an inactive project and can retry using fresh server state', async () => {
    vi.mocked(learningApi.resolve)
      .mockResolvedValueOnce({ ...resolved('parent', 'parent', ['parent']), project: null, canStart: true })
      .mockResolvedValueOnce(resolved('parent', 'parent', ['parent']));
    const { result } = renderHook(() => useLearningRoute('parent', null));
    await waitFor(() => expect(result.current.error).toContain('尚未开始学习'));
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.resolved?.project?.id).toBe('p_parent'));
    expect(result.current.error).toBeNull();
  });
});
