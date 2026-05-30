import { describe, it, expect } from 'vitest';
import { applyProposalToEditor } from './apply-proposal-to-editor';
import type { Hunk } from './compute-doc-diff';

function mockEditor() {
  const calls: Array<{ op: string; args: unknown }> = [];
  return {
    children: [],
    tf: {
      setNodes: (props: unknown, opts: { at: number[] }) => {
        calls.push({ op: 'setNodes', args: { props, at: opts.at } });
      },
      insertNodes: (nodes: unknown, opts: { at: number[] }) => {
        calls.push({ op: 'insertNodes', args: { nodes, at: opts.at } });
      },
      removeNodes: (opts: { at: number[] }) => {
        calls.push({ op: 'removeNodes', args: { at: opts.at } });
      },
    },
    _calls: calls,
  } as never;
}

describe('applyProposalToEditor', () => {
  it('replace hunk → setNodes(proposal-old) + insertNodes(proposal-new)', () => {
    const ed = mockEditor();
    const hunks: Hunk[] = [
      {
        id: 'h_replace_0_0',
        kind: 'replace',
        blockPath: [0],
        newBlocks: [{ type: 'p', children: [{ text: '新文' }] } as never],
      },
    ];
    applyProposalToEditor(ed, hunks);
    const calls = (ed as never as { _calls: Array<{ op: string; args: { at: number[] } }> })._calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ op: 'setNodes', args: { at: [0] } });
    expect(calls[1]).toMatchObject({ op: 'insertNodes', args: { at: [1] } });
  });

  it('delete hunk → setNodes(proposal-old)', () => {
    const ed = mockEditor();
    const hunks: Hunk[] = [
      { id: 'h_delete_2', kind: 'delete', blockPath: [2] },
    ];
    applyProposalToEditor(ed, hunks);
    const calls = (ed as never as { _calls: Array<{ op: string; args: { at: number[] } }> })._calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'setNodes', args: { at: [2] } });
  });

  it('insert hunk → insertNodes(proposal-new) at blockPath', () => {
    const ed = mockEditor();
    const hunks: Hunk[] = [
      {
        id: 'h_insert_3',
        kind: 'insert',
        blockPath: [3],
        newBlocks: [{ type: 'p', children: [{ text: '插入' }] } as never],
      },
    ];
    applyProposalToEditor(ed, hunks);
    const calls = (ed as never as { _calls: Array<{ op: string; args: { at: number[] } }> })._calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'insertNodes', args: { at: [3] } });
  });

  it('多 hunks 按 blockPath 倒序应用(防位置漂移)', () => {
    const ed = mockEditor();
    const hunks: Hunk[] = [
      { id: 'h_delete_0', kind: 'delete', blockPath: [0] },
      { id: 'h_delete_2', kind: 'delete', blockPath: [2] },
      { id: 'h_delete_1', kind: 'delete', blockPath: [1] },
    ];
    applyProposalToEditor(ed, hunks);
    const calls = (ed as never as { _calls: Array<{ op: string; args: { at: number[] } }> })._calls;
    expect(calls.map((c) => c.args.at[0])).toEqual([2, 1, 0]);
  });

  it('newBlocks 节点带 hunkId 属性传入 insertNodes', () => {
    const ed = mockEditor();
    const hunks: Hunk[] = [
      {
        id: 'h_replace_1_1',
        kind: 'replace',
        blockPath: [1],
        newBlocks: [{ type: 'p', children: [{ text: 'X' }] } as never],
      },
    ];
    applyProposalToEditor(ed, hunks);
    const calls = (ed as never as { _calls: Array<{ op: string; args: { nodes: unknown[] } }> })._calls;
    const insertedNodes = calls[1].args.nodes as Array<{ type: string; hunkId: string }>;
    expect(insertedNodes[0].type).toBe('proposal-new');
    expect(insertedNodes[0].hunkId).toBe('h_replace_1_1');
  });

  it('hunks 为空 → 0 操作', () => {
    const ed = mockEditor();
    applyProposalToEditor(ed, []);
    const calls = (ed as never as { _calls: unknown[] })._calls;
    expect(calls).toHaveLength(0);
  });
});
