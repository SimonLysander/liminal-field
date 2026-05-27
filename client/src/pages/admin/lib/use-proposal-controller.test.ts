import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProposalController, type Proposal } from './use-proposal-controller';
import type { Hunk } from './compute-doc-diff';
import { readResolved, __clearAllResolvedForTest } from './resolved-store';

/**
 * mock editor 实现:
 * - children:可变数组,setNodes/removeNodes 实际改它
 * - tf.setNodes(props, {at:[i]}):children[i] = { ...children[i], ...props }(undefined 字段过滤)
 * - tf.removeNodes({at:[i]}):children.splice(i, 1)
 * - tf.insertNodes(nodes, {at:[i]}):children.splice(i, 0, ...nodes)
 */
function mockEditor(initial: Array<Record<string, unknown>>) {
  const children = [...initial];
  const editor = {
    children,
    tf: {
      setNodes: (props: Record<string, unknown>, opts: { at: number[] }) => {
        const idx = opts.at[0];
        const merged: Record<string, unknown> = { ...children[idx], ...props };
        for (const k of Object.keys(props)) {
          if (props[k] === undefined) delete merged[k];
        }
        children[idx] = merged;
      },
      insertNodes: (nodes: Array<Record<string, unknown>>, opts: { at: number[] }) => {
        children.splice(opts.at[0], 0, ...nodes);
      },
      removeNodes: (opts: { at: number[] }) => {
        children.splice(opts.at[0], 1);
      },
    },
  } as never;
  return editor;
}

const sampleProposal = (hunks: Hunk[]): Proposal => ({
  callId: 'call_1',
  newMarkdown: '...',
  reason: 'r',
  hunks,
});

describe('useProposalController (v3.1 节点树版)', () => {
  beforeEach(() => {
    __clearAllResolvedForTest();
  });

  it('setProposal(replace) → 节点树展开为 [proposal-old, proposal-new] 对', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '旧段' }] }]);
    const { result } = renderHook(() => useProposalController(editor));
    act(() =>
      result.current.setProposal(
        sampleProposal([
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新段' }] } as never],
          },
        ]),
      ),
    );
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({ type: 'proposal-old', hunkId: 'h_replace_0_0' });
    expect(children[1]).toMatchObject({ type: 'proposal-new', hunkId: 'h_replace_0_0' });
    expect(result.current.hasPending).toBe(true);
  });

  it('acceptOne(replace) → proposal-old 删,proposal-new 改回 p', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '旧段' }] }]);
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal(
        sampleProposal([
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新段' }] } as never],
          },
        ]),
      ),
    );
    act(() => result.current.acceptOne('h_replace_0_0'));
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('p');
    expect(children[0].hunkId).toBeUndefined();
    expect(onResolved).toHaveBeenCalledWith('CLEAN');
  });

  it('rejectOne(replace) → proposal-new 删,proposal-old 改回 p', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '旧段' }] }]);
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal(
        sampleProposal([
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新段' }] } as never],
          },
        ]),
      ),
    );
    act(() => result.current.rejectOne('h_replace_0_0'));
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('p');
    expect(children[0].hunkId).toBeUndefined();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('acceptOne(delete) → proposal-old 删', () => {
    const editor = mockEditor([
      { type: 'p', children: [{ text: '段一' }] },
      { type: 'p', children: [{ text: '段二' }] },
    ]);
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved: vi.fn(), serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal(
        sampleProposal([{ id: 'h_delete_1', kind: 'delete', blockPath: [1] }]),
      ),
    );
    act(() => result.current.acceptOne('h_delete_1'));
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ type: 'p' });
  });

  it('acceptAll → 所有 hunks 节点全部 promote/remove + 触发 onResolved', () => {
    const editor = mockEditor([
      { type: 'p', children: [{ text: '段一' }] },
      { type: 'p', children: [{ text: '段二' }] },
    ]);
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal(
        sampleProposal([
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新一' }] } as never],
          },
          {
            id: 'h_replace_1_1',
            kind: 'replace',
            blockPath: [1],
            newBlocks: [{ type: 'p', children: [{ text: '新二' }] } as never],
          },
        ]),
      ),
    );
    act(() => result.current.acceptAll());
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children).toHaveLength(2);
    children.forEach((c) => {
      expect(c.type).toBe('p');
      expect(c.hunkId).toBeUndefined();
    });
    expect(onResolved).toHaveBeenCalledWith('CLEAN');
  });

  it('setProposal(undefined) → 撤回残留 proposal-* 节点', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '段' }] }]);
    const { result } = renderHook(() => useProposalController(editor));
    act(() =>
      result.current.setProposal(
        sampleProposal([
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新' }] } as never],
          },
        ]),
      ),
    );
    act(() => result.current.setProposal(undefined));
    const children = (editor as never as { children: Array<Record<string, unknown>> }).children;
    expect(children.every((c) => c.type === 'p')).toBe(true);
    expect(children.every((c) => c.hunkId === undefined)).toBe(true);
  });

  it('hasPending 在裁决过程中正确反映', () => {
    const editor = mockEditor([
      { type: 'p', children: [{ text: '段一' }] },
      { type: 'p', children: [{ text: '段二' }] },
    ]);
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved: vi.fn(), serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal(
        sampleProposal([
          { id: 'h_delete_0', kind: 'delete', blockPath: [0] },
          { id: 'h_delete_1', kind: 'delete', blockPath: [1] },
        ]),
      ),
    );
    expect(result.current.hasPending).toBe(true);
    act(() => result.current.acceptOne('h_delete_0'));
    expect(result.current.hasPending).toBe(true);
    act(() => result.current.rejectOne('h_delete_1'));
    expect(result.current.hasPending).toBe(false);
  });

  // ── resolved-store 集成:防"裁决完→刷新→又拉起审批"的 bug ──
  it('全部接受后,callId 被标记到 resolved-store', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '旧' }] }]);
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved: vi.fn(), serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal({
        callId: 'call_accept_all',
        newMarkdown: '...',
        reason: 'r',
        hunks: [
          {
            id: 'h_replace_0_0',
            kind: 'replace',
            blockPath: [0],
            newBlocks: [{ type: 'p', children: [{ text: '新' }] } as never],
          },
        ],
      }),
    );
    act(() => result.current.acceptAll());
    expect(readResolved().has('call_accept_all')).toBe(true);
  });

  it('全部拒绝后,callId 也被标记到 resolved-store(不区分接受/拒绝)', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '旧' }] }]);
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved, serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal({
        callId: 'call_reject_all',
        newMarkdown: '...',
        reason: 'r',
        hunks: [
          {
            id: 'h_delete_0',
            kind: 'delete',
            blockPath: [0],
          },
        ],
      }),
    );
    act(() => result.current.rejectAll());
    expect(readResolved().has('call_reject_all')).toBe(true);
    // 全拒绝不调 onResolved(不写 bodyMarkdown)
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('逐项裁决完,callId 也被标记 resolved(部分接受+部分拒绝)', () => {
    const editor = mockEditor([
      { type: 'p', children: [{ text: '段一' }] },
      { type: 'p', children: [{ text: '段二' }] },
    ]);
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved: vi.fn(), serializeMd: () => 'CLEAN' }),
    );
    act(() =>
      result.current.setProposal({
        callId: 'call_mixed',
        newMarkdown: '...',
        reason: 'r',
        hunks: [
          { id: 'h_delete_0', kind: 'delete', blockPath: [0] },
          { id: 'h_delete_1', kind: 'delete', blockPath: [1] },
        ],
      }),
    );
    act(() => result.current.acceptOne('h_delete_0'));
    expect(readResolved().has('call_mixed')).toBe(false); // 还没全裁决
    act(() => result.current.rejectOne('h_delete_1'));
    expect(readResolved().has('call_mixed')).toBe(true); // 全裁决后 mark
  });

  it('多个 callId 各自独立标记', () => {
    const editor = mockEditor([{ type: 'p', children: [{ text: '段' }] }]);
    const { result } = renderHook(() =>
      useProposalController(editor, { onResolved: vi.fn(), serializeMd: () => 'CLEAN' }),
    );
    // 第一个 proposal
    act(() =>
      result.current.setProposal({
        callId: 'call_A',
        newMarkdown: '...',
        reason: '',
        hunks: [{ id: 'h_delete_0', kind: 'delete', blockPath: [0] }],
      }),
    );
    act(() => result.current.acceptAll());
    // 第二个 proposal(新 callId)
    act(() =>
      result.current.setProposal({
        callId: 'call_B',
        newMarkdown: '...',
        reason: '',
        hunks: [{ id: 'h_delete_0', kind: 'delete', blockPath: [0] }],
      }),
    );
    act(() => result.current.acceptAll());
    expect(readResolved().has('call_A')).toBe(true);
    expect(readResolved().has('call_B')).toBe(true);
  });
});
