/**
 * useDraftEditor 单测 —— 「文稿编辑」内核的核心不变量(笔记/文集条目共用)。
 *
 * 覆盖:草稿优先加载、无草稿读正式版、loadDraft 失败容错、local-first reconcile(未同步内容
 * 覆盖+标脏)、setField 标脏、1.5s debounce 自动保存、提交(commit+清本地+跳转)、丢弃(确认+跳转)。
 *
 * 隔离手段:mock react-router-dom 的 useNavigate/useLocation 与 ConfirmContext 的 useConfirm,
 * 这样无需 Provider 包裹即可直接 renderHook;adapter 全部用 vi.fn 注入。
 * 时间:用 vitest 假定时器驱动 debounce/提交跳转;异步加载用 await microtask 冲刷。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDraftEditor, type DraftEditorAdapter } from './use-draft-editor';

// ── mock 路由:导出 navigate spy 供断言;location.key='default' 让 goBack 走 fallbackPath ──
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ key: 'default', pathname: '/' }),
}));

// ── mock 确认弹窗:默认确认(true),丢弃用例可改 ──
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@/contexts/ConfirmContext', () => ({
  useConfirm: () => confirmMock,
}));

interface TestState {
  title: string;
  bodyMarkdown: string;
  changeNote: string;
}

const STORAGE_ID = 'test1';
const LOCAL_KEY = `lf-draft:${STORAGE_ID}`;
const published: TestState = { title: 'P', bodyMarkdown: 'pub', changeNote: '' };

// 可覆写的 adapter 工厂;所有数据接口默认 happy path。
function makeAdapter(
  over: Partial<DraftEditorAdapter<TestState>> = {},
): DraftEditorAdapter<TestState> {
  return {
    ready: true,
    storageKey: STORAGE_ID,
    initialState: { title: '', bodyMarkdown: '', changeNote: '' },
    loadDraft: vi.fn().mockResolvedValue(null),
    loadPublished: vi.fn().mockResolvedValue(published),
    saveDraft: vi.fn().mockResolvedValue({ savedAt: '2026-05-24T10:00:00Z' }),
    commit: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    fallbackPath: '/admin/notes',
    ...over,
  };
}

// 冲刷加载链的 microtask(adapter 的 resolved promise);假定时器不影响 Promise 微任务。
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  navigateMock.mockClear();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftEditor 加载', () => {
  it('有草稿 → 用草稿内容 + savedAt,不读正式版', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn().mockResolvedValue({
        state: { title: 'D', bodyMarkdown: 'draft body', changeNote: '' },
        savedAt: '2026-05-24T09:00:00Z',
      }),
    });
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.loaded).toBe(true);
    expect(result.current.state.title).toBe('D');
    expect(result.current.lastSavedAt).toBe('2026-05-24T09:00:00Z');
    expect(adapter.loadPublished).not.toHaveBeenCalled();
  });

  it('无草稿 → 读正式版,lastSavedAt 留空(尚无草稿)', async () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(adapter.loadPublished).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual(published);
    expect(result.current.lastSavedAt).toBe('');
  });

  it('loadDraft 抛错 → 容错为无草稿,继续读正式版', async () => {
    const adapter = makeAdapter({
      loadDraft: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(result.current.error).toBe('');
    expect(adapter.loadPublished).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual(published);
  });

  it('ready=false → 不加载(数据接口都不调用,保持 loading)', async () => {
    const adapter = makeAdapter({ ready: false });
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(adapter.loadDraft).not.toHaveBeenCalled();
    expect(adapter.loadPublished).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('local-first reconcile:本地有未同步内容 → 覆盖加载结果并标脏', async () => {
    const localState: TestState = {
      title: '本地未同步',
      bodyMarkdown: 'local body',
      changeNote: '',
    };
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ data: localState, ts: Date.now() }));
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(result.current.state).toEqual(localState);
    expect(result.current.isDirty).toBe(true);
  });
});

describe('useDraftEditor 编辑与保存', () => {
  it('setField → 标脏', async () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setField('title', '新标题'));
    expect(result.current.state.title).toBe('新标题');
    expect(result.current.isDirty).toBe(true);
  });

  it('改字 1.5s 后自动保存草稿,并落 lastSavedAt、清脏', async () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    act(() => result.current.setField('title', '改一下'));
    // 推进过防抖窗口,触发 silent 自动保存
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(adapter.saveDraft).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.lastSavedAt).toBe('2026-05-24T10:00:00Z');
  });

  it('改字即时镜像到 localStorage(崩溃不丢字)', async () => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    act(() => result.current.setField('bodyMarkdown', '即时内容'));
    // mirror effect 在 state 变更后同步写本地,无需推进定时器
    await flush();
    const raw = localStorage.getItem(LOCAL_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).data.bodyMarkdown).toBe('即时内容');
  });
});

describe('useDraftEditor 提交与丢弃', () => {
  it('提交 → 调 commit、清本地草稿、800ms 后跳转 fallbackPath', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ data: published, ts: Date.now() }));
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    await act(async () => {
      await result.current.commitDraft();
    });
    expect(adapter.commit).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull(); // 已提交,本地草稿清掉
    expect(result.current.lastSavedAt).toBe('');
    // 跳转在 800ms 延时后
    expect(navigateMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(navigateMock).toHaveBeenCalledWith('/admin/notes');
  });

  it('提交失败 → 不跳转,落 error', async () => {
    const adapter = makeAdapter({
      commit: vi.fn().mockRejectedValue(new Error('commit boom')),
    });
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    await act(async () => {
      await result.current.commitDraft();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.error).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('丢弃:确认后调 discard、清本地草稿、跳转', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ data: published, ts: Date.now() }));
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    await act(async () => {
      await result.current.discardDraft();
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(adapter.discard).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith('/admin/notes');
  });

  it('丢弃:用户取消确认 → 不调 discard、不跳转', async () => {
    confirmMock.mockResolvedValue(false);
    const adapter = makeAdapter();
    const { result } = renderHook(() => useDraftEditor(adapter));
    await flush();
    await act(async () => {
      await result.current.discardDraft();
    });
    expect(adapter.discard).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
