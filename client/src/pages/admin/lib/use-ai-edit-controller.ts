/**
 * useAiEditController —— v2 改稿在 <Plate> context 内的总控。
 *
 * 数据流:上层透传一个 PendingAiEdit(tool + newMarkdown + 它的 toolCallId);
 * hook 监到新 pending(用 lastKeyRef 防 re-render 重复应用)就调 applyAiEdit。
 * outcomes 按 callId 索引(Record),Task 7 卡片渲染时按 toolCallId 查对应 outcome。
 *
 * 沿用 v1 useProposedEditController 的状态机骨架:
 * - hasPending → readOnly + onChange 跳过序列化(防旧+新叠加污染草稿)
 * - acceptAll / rejectAll 用 SuggestionPlugin 同套 API 遍历裁决
 * - 裁决完毕(remaining===0)→ 主动 serializeMd 干净正文回流到 onResolved,
 *   触发上游 setBody(md,true) 强制标脏保存(裁决时焦点不在编辑器,onChange 漏存)
 *
 * 与 v1 controller 差异:
 * - 入参:单个 pending(callId 去重)而非 edits 数组 + key
 * - outcomes 形态:Record<callId, AiEditOutcome>(按 toolCallId 索引,Task 7 卡片用)
 * - applyAiEdit 返回单个 outcome(不是数组),失败/成功一次完成
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorRef } from 'platejs/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  acceptSuggestion,
  rejectSuggestion,
  getSuggestionKeyId,
  keyId2SuggestionId,
} from '@platejs/suggestion';
import { serializeMd } from '@platejs/markdown';

import { applyAiEdit, type AiEditTool, type AiEditOutcome } from './apply-ai-edit';
import type { AnchorPayload } from './serialize-anchor';

/**
 * 单次 AI 改稿任务的描述。
 * - tool:三工具之一,决定 applyAiEdit 路由到哪条 transform
 * - newMarkdown:模型给的新文本(applyAISuggestions / insertAINodes 的输入)
 * - callId:AI SDK 给每次工具调用的唯一 id,前端去重 + outcomes 索引匹配卡片
 */
export interface PendingAiEdit {
  tool: AiEditTool;
  newMarkdown: string;
  callId: string;
}

export function useAiEditController(
  pending: PendingAiEdit | undefined,
  anchor: AnchorPayload,
  // 裁决完毕(节点树已无未决 suggestion)回调干净正文,供上游主动触发保存 + 解锁。
  // 因为裁决发生时焦点不在编辑器,onChange 链路会判"非用户编辑"漏存,故主动序列化推上去。
  onResolved?: (cleanMarkdown: string) => void,
) {
  const editor = useEditorRef();
  // outcomes 按 callId 索引:Task 7 渲染卡片时按 toolCallId 查对应 outcome,失败标红
  const [outcomesByCallId, setOutcomesByCallId] = useState<Record<string, AiEditOutcome>>({});
  // 有未决 suggestion → "审阅锁定":<Plate readOnly>;裁决完毕解锁
  const [hasPending, setHasPending] = useState(false);
  // 去重 guard:记录上一次已应用的 callId,同一次工具调用只落一次 suggestion
  const lastKeyRef = useRef<string>('');
  // onResolved 用 ref 取最新,避免引用变动导致 resolveAll 重建依赖
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  useEffect(() => {
    if (!pending || !pending.newMarkdown) return;
    if (lastKeyRef.current === pending.callId) return;
    lastKeyRef.current = pending.callId;
    // anchor 不进依赖:每次 pending 变化时取最新的 anchor(由 Bridge 透过闭包带入)。
    // pending 是离散事件、anchor 是连续流;若 anchor 进依赖,锚点频繁变化会让本 effect
    // 重跑——但 lastKeyRef 会 short-circuit,实质等价。不进依赖更直观。
    const outcome = applyAiEdit(editor, pending.tool, pending.newMarkdown, anchor);
    setOutcomesByCallId((prev) => ({ ...prev, [pending.callId]: outcome }));
    // 成功 → 锁定;失败(no-anchor / parse-error)→ 没产生 suggestion 不锁定
    setHasPending(outcome.ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pending]);

  /**
   * 遍历全文所有 suggestion 节点,逐个 accept/reject(@platejs/suggestion 无批量 API)。
   * v1 controller 已用过同套 SuggestionPlugin API,这里复用。
   * 全部裁决完(remaining===0)→ 解锁 + 主动 serializeMd 干净正文回流。
   */
  const resolveAll = (accept: boolean) => {
    const api = editor.getApi(SuggestionPlugin).suggestion;
    const seen = new Set<string>();

    for (const [node] of api.nodes({ at: [] })) {
      const keyId = getSuggestionKeyId(node as never);
      if (!keyId) continue;
      const id = keyId2SuggestionId(keyId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // 从 leaf 节点上取 suggestion data(type / userId / createdAt),填 TResolvedSuggestion
      const data = (node as Record<string, unknown>)[keyId] as
        | {
            id: string;
            type: 'insert' | 'remove' | 'replace' | 'update';
            createdAt: number;
            userId: string;
          }
        | undefined;
      const desc = {
        suggestionId: id,
        keyId,
        type: (data?.type ?? 'update') as 'insert' | 'remove' | 'replace' | 'update',
        userId: data?.userId ?? 'aurora',
        createdAt: data?.createdAt ? new Date(data.createdAt) : new Date(),
      };
      (accept ? acceptSuggestion : rejectSuggestion)(editor, desc);
    }

    // 裁决后重查;空即全部已裁决 → 解锁 + 干净正文回流
    const remaining = api.nodes({ at: [] }).length;
    if (remaining === 0) {
      setHasPending(false);
      try {
        const md = serializeMd(editor);
        onResolvedRef.current?.(md);
      } catch (err) {
        // 序列化失败不吞:记错误,后续用户编辑会再触发 onChange 兜底
        if (import.meta.env.DEV) console.error('[ai-edit] resolveAll 序列化失败', err);
      }
    }

    if (import.meta.env.DEV) {
      console.debug(
        `[ai-edit] resolveAll accept=${accept} resolved=${seen.size} remaining=${remaining}`,
      );
    }
  };

  return {
    outcomesByCallId,
    hasPending,
    acceptAll: () => resolveAll(true),
    rejectAll: () => resolveAll(false),
  };
}
