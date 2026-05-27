import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hunk } from './compute-doc-diff';

/**
 * useProposalController —— v3 改稿状态机。
 *
 * 职责：
 *   - 接收 AI 产出的一发 Proposal(callId + newMarkdown + reason + hunks)
 *   - 管理逐项 / 批量裁决(accept / reject)
 *   - 全裁决后：把 accepted hunks 按 blockPath[0] **从后往前**应用到 editor
 *     (倒序避免前面改动导致后面块路径漂移)
 *   - 调 serializeMd 获得干净 markdown → 调 onResolved(md) 通知上层存储
 *   - 仅当有 accepted hunks 时触发 onResolved；全拒绝时只清空状态，不覆盖内容
 *
 * 设计依据：
 *   v2 §6.5 状态机骨架；hasPending=true 时上层可将编辑器置 readOnly。
 *   实现层不进 Plate 节点树，onApply 由调用方注入（便于测试 mock）。
 *
 * 全裁决检测设计：
 *   不用 useEffect 监听 decisions 变化（会触发 react-hooks/set-state-in-effect lint 错误）。
 *   改用 ref 同步追踪最新 decisions，在每个裁决动作内直接检测并触发 finalize。
 */

export interface Proposal {
  callId: string;
  newMarkdown: string;
  reason: string;
  hunks: Hunk[];
}

export type Decision = 'accepted' | 'rejected';

export interface UseProposalControllerOptions {
  /** 应用单个 accepted hunk 到 editor。生产时传 applyHunkToEditor */
  onApply?: (hunk: Hunk) => void;
  /**
   * 全裁决完、有 accepted hunks 应用后，拿到干净 markdown 的回调。
   * 由上层用来 setBody。全拒绝时不调用。
   */
  onResolved?: (cleanMarkdown: string) => void;
  /** 序列化 editor 为 markdown。生产时传 () => serializeMd(editor) */
  serializeMd?: () => string;
}

export function useProposalController(
  _editor: unknown,
  options: UseProposalControllerOptions = {},
) {
  const [proposal, setProposalState] = useState<Proposal | undefined>(undefined);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());

  // ref 同步追踪 proposal/decisions，让裁决动作内的闭包拿到最新值
  const proposalRef = useRef<Proposal | undefined>(undefined);
  const decisionsRef = useRef<Map<string, Decision>>(new Map());
  // 用 ref 保存 options，避免 stale closure 拿到旧回调
  // 用 useEffect 更新（lint react-hooks/refs 禁止在 render 期间直接写 ref.current）
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const hunks = proposal?.hunks ?? [];
  // hasPending：proposal 存在且还有未裁决的 hunk
  const hasPending = hunks.length > 0 && hunks.some((h) => !decisions.has(h.id));

  /**
   * 全裁决后触发：
   * 1. 收集 accepted hunks，按 blockPath[0] 倒序排列（倒序应用避免前面修改导致后面路径漂移）
   * 2. 逐个调 onApply（由上层实际写入编辑器）
   * 3. 若有 accepted → serializeMd → onResolved(md)
   * 4. 清空 proposal（decisions 保留，供调用方最后读取；下次 setProposal 时才重置）
   */
  const finalize = useCallback(
    (currentProposal: Proposal, currentDecisions: Map<string, Decision>) => {
      const accepted = currentProposal.hunks
        .filter((h) => currentDecisions.get(h.id) === 'accepted')
        .sort((a, b) => (b.blockPath?.[0] ?? 0) - (a.blockPath?.[0] ?? 0));

      accepted.forEach((h) => optsRef.current.onApply?.(h));

      if (accepted.length > 0) {
        const md = optsRef.current.serializeMd?.();
        if (md !== undefined) optsRef.current.onResolved?.(md);
      }

      // 仅清空 proposal；decisions 保留让调用方仍可读到最终裁决结果
      // 下次 setProposal 时会同时重置 decisions
      proposalRef.current = undefined;
      setProposalState(undefined);
    },
    [],
  );

  /**
   * 将新的 decisions map 写入 state + ref，然后检查是否全裁决完毕。
   * 将检测内嵌在裁决动作里，避免用 useEffect 内 setState（lint 规则不允许）。
   */
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

  /** 接收新 proposal，或传 undefined 清空 */
  const setProposal = useCallback((p: Proposal | undefined) => {
    proposalRef.current = p;
    decisionsRef.current = new Map();
    setProposalState(p);
    setDecisions(new Map());
  }, []);

  const acceptOne = useCallback((id: string) => {
    commitDecisions(new Map(decisionsRef.current).set(id, 'accepted'));
  }, [commitDecisions]);

  const rejectOne = useCallback((id: string) => {
    commitDecisions(new Map(decisionsRef.current).set(id, 'rejected'));
  }, [commitDecisions]);

  const acceptAll = useCallback(() => {
    const currentProposal = proposalRef.current;
    if (!currentProposal) return;
    const next = new Map<string, Decision>();
    currentProposal.hunks.forEach((h) => next.set(h.id, 'accepted'));
    commitDecisions(next);
  }, [commitDecisions]);

  const rejectAll = useCallback(() => {
    const currentProposal = proposalRef.current;
    if (!currentProposal) return;
    const next = new Map<string, Decision>();
    currentProposal.hunks.forEach((h) => next.set(h.id, 'rejected'));
    commitDecisions(next);
  }, [commitDecisions]);

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
