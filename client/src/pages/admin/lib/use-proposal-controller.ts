import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hunk } from './compute-doc-diff';
import { applyProposalToEditor } from './apply-proposal-to-editor';
import { PROPOSAL_OLD, PROPOSAL_NEW } from '@/components/editor/proposal-plugin';

/**
 * useProposalController —— v3.1 改稿状态机(diff 进节点树版)。
 *
 * 与 v3 的关键差异:
 * - setProposal(p):除 setState 外,**立刻调 applyProposalToEditor** 把 hunks 展开成
 *   proposal-old/proposal-new 节点对。
 * - acceptOne/rejectOne:直接遍历 editor.children 找 hunkId 对应节点,setNodes 改回 'p'
 *   或 removeNodes 删除。不再用 onApply 回调。
 * - finalize:节点树裁决完已干净 → serializeMd 直接安全。
 *
 * 沿用 v3 useState + ref 模式避开 effect-setState lint;hasPending=true 时编辑器 readOnly。
 */

export interface Proposal {
  callId: string;
  newMarkdown: string;
  reason: string;
  hunks: Hunk[];
}

export type Decision = 'accepted' | 'rejected';

export interface UseProposalControllerOptions {
  /** 全裁决完拿到干净 markdown 的回调(让上层 setBody)。仅当有 accepted hunks 时触发 */
  onResolved?: (cleanMarkdown: string) => void;
  /** 序列化 editor 为 markdown:() => serializeMd(editor) */
  serializeMd?: () => string;
}

interface PlateEditorLike {
  children: Array<{ type?: string; hunkId?: string } & Record<string, unknown>>;
  tf: {
    setNodes: (props: unknown, opts: { at: number[]; match?: (n: unknown) => boolean }) => void;
    removeNodes: (opts: { at: number[]; match?: (n: unknown) => boolean }) => void;
  };
}

/** 找到所有 `type=targetType` 且 `hunkId=hunkId` 的顶层节点 path */
function findHunkNodePaths(editor: PlateEditorLike, hunkId: string, targetType: string): number[][] {
  const paths: number[][] = [];
  editor.children.forEach((n, i) => {
    if (n.type === targetType && n.hunkId === hunkId) paths.push([i]);
  });
  return paths;
}

export function useProposalController(
  editor: unknown,
  options: UseProposalControllerOptions = {},
) {
  const ed = editor as PlateEditorLike;
  const [proposal, setProposalState] = useState<Proposal | undefined>(undefined);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());

  const proposalRef = useRef<Proposal | undefined>(undefined);
  const decisionsRef = useRef<Map<string, Decision>>(new Map());
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const hunks = proposal?.hunks ?? [];
  const hasPending = hunks.length > 0 && hunks.some((h) => !decisions.has(h.id));

  /**
   * 全裁决后:节点树此刻已只剩正常 'p' 节点,serializeMd 安全。
   * 仅当有 accepted hunks 时触发 onResolved(全拒绝时不写回 bodyMarkdown)。
   */
  const finalize = useCallback(
    (currentProposal: Proposal, currentDecisions: Map<string, Decision>) => {
      const hasAccepted = currentProposal.hunks.some(
        (h) => currentDecisions.get(h.id) === 'accepted',
      );
      if (hasAccepted) {
        const md = optsRef.current.serializeMd?.();
        if (md !== undefined) optsRef.current.onResolved?.(md);
      }
      proposalRef.current = undefined;
      setProposalState(undefined);
    },
    [],
  );

  /**
   * 接收新 proposal:setState + 立刻 applyProposalToEditor 展开节点树。
   * 传 undefined 时清空 — 撤回所有未决节点(防御性,正常流程裁决完已无节点)。
   */
  const setProposal = useCallback(
    (p: Proposal | undefined) => {
      if (p) {
        proposalRef.current = p;
        decisionsRef.current = new Map();
        setProposalState(p);
        setDecisions(new Map());
        // 关键:立刻展开节点树
        applyProposalToEditor(editor, p.hunks);
      } else {
        // 撤回:把残留 proposal-old 改回 'p',删除 proposal-new
        const oldPaths: number[][] = [];
        const newPaths: number[][] = [];
        ed.children.forEach((n, i) => {
          if (n.type === PROPOSAL_OLD) oldPaths.push([i]);
          else if (n.type === PROPOSAL_NEW) newPaths.push([i]);
        });
        // 倒序避免漂移
        newPaths.sort((a, b) => b[0] - a[0]).forEach((p2) => ed.tf.removeNodes({ at: p2 }));
        oldPaths.sort((a, b) => b[0] - a[0]).forEach((p2) =>
          ed.tf.setNodes({ type: 'p', hunkId: undefined }, { at: p2 }),
        );
        proposalRef.current = undefined;
        decisionsRef.current = new Map();
        setProposalState(undefined);
        setDecisions(new Map());
      }
    },
    [editor, ed],
  );

  const commitDecisions = useCallback(
    (nextDecisions: Map<string, Decision>) => {
      decisionsRef.current = nextDecisions;
      setDecisions(nextDecisions);
      const currentProposal = proposalRef.current;
      if (!currentProposal || currentProposal.hunks.length === 0) return;
      const allDecided = currentProposal.hunks.every((h) => nextDecisions.has(h.id));
      if (allDecided) finalize(currentProposal, nextDecisions);
    },
    [finalize],
  );

  /**
   * 接受单个 hunk:
   * - 找节点树里 hunkId 对应的 proposal-old 节点 → removeNodes
   * - 找 proposal-new 节点 → setNodes({type:'p', hunkId:undefined}) 转为正常段
   * 倒序 + decisions 更新 + commitDecisions 检测全裁决。
   */
  const acceptOne = useCallback(
    (hunkId: string) => {
      const oldPaths = findHunkNodePaths(ed, hunkId, PROPOSAL_OLD);
      const newPaths = findHunkNodePaths(ed, hunkId, PROPOSAL_NEW);
      // 倒序处理:大 path 先
      const all = [
        ...oldPaths.map((p) => ({ kind: 'remove' as const, path: p })),
        ...newPaths.map((p) => ({ kind: 'promote' as const, path: p })),
      ].sort((a, b) => b.path[0] - a.path[0]);
      for (const op of all) {
        if (op.kind === 'remove') ed.tf.removeNodes({ at: op.path });
        else ed.tf.setNodes({ type: 'p', hunkId: undefined }, { at: op.path });
      }
      commitDecisions(new Map(decisionsRef.current).set(hunkId, 'accepted'));
    },
    [ed, commitDecisions],
  );

  /**
   * 拒绝单个 hunk:
   * - 找 proposal-new 节点 → removeNodes(放弃 AI 提议)
   * - 找 proposal-old 节点 → setNodes({type:'p', hunkId:undefined}) 恢复原段
   */
  const rejectOne = useCallback(
    (hunkId: string) => {
      const oldPaths = findHunkNodePaths(ed, hunkId, PROPOSAL_OLD);
      const newPaths = findHunkNodePaths(ed, hunkId, PROPOSAL_NEW);
      const all = [
        ...newPaths.map((p) => ({ kind: 'remove' as const, path: p })),
        ...oldPaths.map((p) => ({ kind: 'restore' as const, path: p })),
      ].sort((a, b) => b.path[0] - a.path[0]);
      for (const op of all) {
        if (op.kind === 'remove') ed.tf.removeNodes({ at: op.path });
        else ed.tf.setNodes({ type: 'p', hunkId: undefined }, { at: op.path });
      }
      commitDecisions(new Map(decisionsRef.current).set(hunkId, 'rejected'));
    },
    [ed, commitDecisions],
  );

  const acceptAll = useCallback(() => {
    const currentProposal = proposalRef.current;
    if (!currentProposal) return;
    currentProposal.hunks.forEach((h) => {
      const oldPaths = findHunkNodePaths(ed, h.id, PROPOSAL_OLD);
      const newPaths = findHunkNodePaths(ed, h.id, PROPOSAL_NEW);
      const all = [
        ...oldPaths.map((p) => ({ kind: 'remove' as const, path: p })),
        ...newPaths.map((p) => ({ kind: 'promote' as const, path: p })),
      ].sort((a, b) => b.path[0] - a.path[0]);
      for (const op of all) {
        if (op.kind === 'remove') ed.tf.removeNodes({ at: op.path });
        else ed.tf.setNodes({ type: 'p', hunkId: undefined }, { at: op.path });
      }
    });
    const next = new Map<string, Decision>();
    currentProposal.hunks.forEach((h) => next.set(h.id, 'accepted'));
    commitDecisions(next);
  }, [ed, commitDecisions]);

  const rejectAll = useCallback(() => {
    const currentProposal = proposalRef.current;
    if (!currentProposal) return;
    currentProposal.hunks.forEach((h) => {
      const oldPaths = findHunkNodePaths(ed, h.id, PROPOSAL_OLD);
      const newPaths = findHunkNodePaths(ed, h.id, PROPOSAL_NEW);
      const all = [
        ...newPaths.map((p) => ({ kind: 'remove' as const, path: p })),
        ...oldPaths.map((p) => ({ kind: 'restore' as const, path: p })),
      ].sort((a, b) => b.path[0] - a.path[0]);
      for (const op of all) {
        if (op.kind === 'remove') ed.tf.removeNodes({ at: op.path });
        else ed.tf.setNodes({ type: 'p', hunkId: undefined }, { at: op.path });
      }
    });
    const next = new Map<string, Decision>();
    currentProposal.hunks.forEach((h) => next.set(h.id, 'rejected'));
    commitDecisions(next);
  }, [ed, commitDecisions]);

  return {
    proposal,
    hunks,
    decisions,
    hasPending,
    setProposal,
    acceptOne,
    rejectOne,
    acceptAll,
    rejectAll,
  };
}
