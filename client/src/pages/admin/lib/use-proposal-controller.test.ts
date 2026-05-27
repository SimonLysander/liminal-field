import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProposalController, type Proposal } from './use-proposal-controller';
import type { Hunk } from './compute-doc-diff';

// Mock editor:测试不依赖真 Plate
function mockEditor() {
  const children = [
    { type: 'p', children: [{ text: '段一。' }] },
    { type: 'p', children: [{ text: '段二。' }] },
  ];
  return {
    children,
    tf: { setNodes: vi.fn(), removeNodes: vi.fn(), insertNodes: vi.fn() },
  } as never;
}

const sampleProposal = (hunks: Hunk[]): Proposal => ({
  callId: 'call_1',
  newMarkdown: '...',
  reason: 'r',
  hunks,
});

describe('useProposalController', () => {
  it('收到 proposal → hunks 入状态 + hasPending=true', () => {
    const editor = mockEditor();
    const { result } = renderHook(() => useProposalController(editor));
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0], oldText: 'a', newText: 'b' },
        ]),
      );
    });
    expect(result.current.hasPending).toBe(true);
    expect(result.current.hunks).toHaveLength(1);
  });

  it('proposal=undefined → 清空状态', () => {
    const editor = mockEditor();
    const { result } = renderHook(() => useProposalController(editor));
    act(() => {
      result.current.setProposal(
        sampleProposal([{ id: 'h1', kind: 'replace', blockPath: [0] } as never]),
      );
    });
    act(() => result.current.setProposal(undefined));
    expect(result.current.hasPending).toBe(false);
    expect(result.current.hunks).toHaveLength(0);
  });

  it('acceptOne → decisions 更新;rejectOne → 同样', () => {
    const editor = mockEditor();
    const { result } = renderHook(() => useProposalController(editor));
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0] } as never,
          { id: 'h2', kind: 'replace', blockPath: [1] } as never,
        ]),
      );
    });
    act(() => result.current.acceptOne('h1'));
    expect(result.current.decisions.get('h1')).toBe('accepted');
    act(() => result.current.rejectOne('h2'));
    expect(result.current.decisions.get('h2')).toBe('rejected');
  });

  it('全裁决完 → onResolved 被调用 + 内部状态清空', () => {
    const editor = mockEditor();
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN_MD' }),
    );
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0] } as never,
        ]),
      );
    });
    act(() => result.current.acceptOne('h1'));
    expect(onResolved).toHaveBeenCalledWith('CLEAN_MD');
    expect(result.current.hasPending).toBe(false);
  });

  it('acceptAll → 所有 hunks decisions=accepted + 触发 onResolved', () => {
    const editor = mockEditor();
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN_MD' }),
    );
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0] } as never,
          { id: 'h2', kind: 'replace', blockPath: [1] } as never,
        ]),
      );
    });
    act(() => result.current.acceptAll());
    expect(onResolved).toHaveBeenCalledWith('CLEAN_MD');
  });

  it('rejectAll → 所有 hunks decisions=rejected + 不动 editor + 不调 onResolved(全拒不该 setBody)', () => {
    const editor = mockEditor();
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN_MD' }),
    );
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0] } as never,
        ]),
      );
    });
    act(() => result.current.rejectAll());
    expect(onResolved).not.toHaveBeenCalled();
    expect(result.current.hasPending).toBe(false);
  });

  it('应用顺序从后往前(多 accepted hunks)', () => {
    const editor = mockEditor();
    const applyOrder: number[] = [];
    const onApply = vi.fn((hunk: Hunk) => {
      applyOrder.push(hunk.blockPath![0]);
    });
    const { result } = renderHook(() =>
      useProposalController(editor, { onApply, serializeMd: () => 'CLEAN_MD' }),
    );
    act(() => {
      result.current.setProposal(
        sampleProposal([
          { id: 'h1', kind: 'replace', blockPath: [0] } as never,
          { id: 'h2', kind: 'replace', blockPath: [2] } as never,
          { id: 'h3', kind: 'replace', blockPath: [1] } as never,
        ]),
      );
    });
    act(() => result.current.acceptAll());
    expect(applyOrder).toEqual([2, 1, 0]);
  });
});
