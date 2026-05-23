/**
 * useLocalDraftBuffer 单测 —— local-first 草稿本地缓冲的核心不变量。
 * 用 vitest + happy-dom(提供 localStorage)。hook 内部只用 useRef/useCallback,无 state 更新,
 * 故直接调用返回的方法即可,无需 act()。
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalDraftBuffer } from './use-local-draft-buffer';

interface Draft {
  title: string;
  body: string;
}

const draft = (body: string): Draft => ({ title: 'T', body });

describe('useLocalDraftBuffer', () => {
  beforeEach(() => localStorage.clear());

  it('无内容时 loadPending 返回 null;onChange 后能读回', () => {
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    expect(result.current.loadPending()).toBeNull();
    result.current.onChange(draft('x'));
    expect(result.current.loadPending()).toEqual(draft('x'));
  });

  it('成功同步(期间无新改动)→ 清空本地(存在即未同步)', () => {
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    result.current.onChange(draft('x'));
    const token = result.current.beginSync();
    result.current.endSync(token);
    expect(result.current.loadPending()).toBeNull();
  });

  it('同步在途时又改字 → endSync 不清空,保留未同步的新内容(防竞态丢笔)', () => {
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    result.current.onChange(draft('x'));
    const token = result.current.beginSync(); // 快照 = x
    result.current.onChange(draft('x2')); // 同步在途时又改
    result.current.endSync(token);
    expect(result.current.loadPending()).toEqual(draft('x2'));
  });

  it('clear() 移除本地草稿', () => {
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    result.current.onChange(draft('x'));
    result.current.clear();
    expect(result.current.loadPending()).toBeNull();
  });

  it('key 为 null → 全部为安全空操作', () => {
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>(null));
    result.current.onChange(draft('x'));
    expect(result.current.loadPending()).toBeNull();
  });

  it('不同 key 的草稿互不干扰', () => {
    const { result: r1 } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    const { result: r2 } = renderHook(() => useLocalDraftBuffer<Draft>('c2'));
    r1.current.onChange(draft('1'));
    expect(r1.current.loadPending()).toEqual(draft('1'));
    expect(r2.current.loadPending()).toBeNull();
  });

  it('localStorage 中 JSON 损坏 → loadPending 容错返回 null', () => {
    localStorage.setItem('lf-draft:c1', '{坏的 json');
    const { result } = renderHook(() => useLocalDraftBuffer<Draft>('c1'));
    expect(result.current.loadPending()).toBeNull();
  });
});
