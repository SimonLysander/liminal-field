/**
 * useProposedEditController —— 在 <Plate> context 内,把外部(聊天)传来的 edits
 * 落成 suggestion,并提供"全部接受/全部拒绝"。
 *
 * 设计要点:
 * - 用 lastKeyRef 去重:同一 editsKey 只应用一次,防止 re-render 重复落 suggestion
 * - resolveAll 遍历全文所有 suggestion 节点,每个唯一 suggestionId 只处理一次
 * - inline suggestion 用 getSuggestionKeyId，block suggestion 用 suggestion.nodeId
 * - suggestionData() 取 TInlineSuggestionData 填充 TResolvedSuggestion(createdAt 为 number → Date)
 * - @platejs/suggestion 无批量 accept/reject API,逐个调用是唯一方式
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorRef } from 'platejs/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  acceptSuggestion,
  getSuggestionKey,
  getSuggestionKeyId,
  rejectSuggestion,
} from '@platejs/suggestion';
import { serializeMd } from '@platejs/markdown';

import { applyProposedEdits, type EditOutcome, type ProposedEdit } from './apply-proposed-edits';

type SuggestionApi = ReturnType<
  ReturnType<typeof useEditorRef>['getApi']
>['suggestion'];

export function getSuggestionResolveDescriptor(
  api: SuggestionApi,
  node: unknown,
) {
  const suggestionId = api.nodeId(node as never);
  if (!suggestionId) return null;

  const data = api.suggestionData(node as never);

  return {
    suggestionId,
    keyId: getSuggestionKeyId(node as never) ?? getSuggestionKey(suggestionId),
    type: (data?.type ?? 'update') as 'insert' | 'remove' | 'replace' | 'update',
    userId: data?.userId ?? 'aurora',
    createdAt: data?.createdAt ? new Date(data.createdAt) : new Date(),
  };
}

export function useProposedEditController(
  pendingEdits: ProposedEdit[] | undefined,
  editsKey: string,
  // 裁决后(节点树已无未决 suggestion)回调干净正文,供上游主动触发保存 + 解锁。
  // 因为裁决发生时焦点不在编辑器,onChange 链路会判"非用户编辑"漏存,故主动序列化推上去。
  onResolved?: (cleanMarkdown: string) => void,
) {
  const editor = useEditorRef();
  const [outcomes, setOutcomes] = useState<EditOutcome[]>([]);
  // 有未决 suggestion 时进入"审阅锁定":编辑器只读、onChange 跳过序列化(防旧+新叠加污染草稿)。
  const [hasPending, setHasPending] = useState(false);
  // 去重 guard:记录上一次已应用的 editsKey,同一批 edits 只落一次 suggestion
  const lastKeyRef = useRef<string>('');
  // onResolved 用 ref 取最新,避免把它放进 resolveAll 依赖、引用变动造成多余重建
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  useEffect(() => {
    if (!pendingEdits || pendingEdits.length === 0) return;
    if (lastKeyRef.current === editsKey) return;
    lastKeyRef.current = editsKey;
    const next = applyProposedEdits(editor, pendingEdits);
    setOutcomes(next);
    // 至少有一处成功落痕迹 → 进入审阅锁定;全失败(无痕迹)→ 无需锁定(false),失败项已在 outcomes 回流标红。
    // 无条件 setState(本 effect 因 lastKeyRef 守卫每批 edits 只跑一次,是 editor 节点树这一外部系统的同步点)。
    setHasPending(next.some((o) => o.ok));
  }, [editor, pendingEdits, editsKey]);

  /**
   * 遍历全文所有 suggestion 节点,对每个唯一 suggestionId 调用 accept/reject。
   * @platejs/suggestion 无批量 API,逐个是官方推荐做法。
   * inline suggestion 的 id 在 suggestion_xxx key 上；block suggestion 的 id 在 node.suggestion.id。
   * 两种都要覆盖，否则块级 diff 落下来的 suggestion 会让“全部接受/拒绝”失效。
   * suggestionData() 返回 TInlineSuggestionData | TSuggestionElement['suggestion'] | undefined;
   * 两者均含 createdAt(number)、userId、type 字段,统一转换后填入 TResolvedSuggestion。
   */
  const resolveAll = (accept: boolean) => {
    const api = editor.getApi(SuggestionPlugin).suggestion;
    const seen = new Set<string>();

    for (const [node] of api.nodes({ at: [] })) {
      const desc = getSuggestionResolveDescriptor(api, node);
      if (!desc) continue;
      if (seen.has(desc.suggestionId)) continue;
      seen.add(desc.suggestionId);

      (accept ? acceptSuggestion : rejectSuggestion)(editor, desc);
    }

    // 裁决后重查节点树是否还有未决 suggestion(api.nodes 返回数组,空即全部已裁决)。
    // 全部裁决完 → 解除审阅锁定,并主动序列化干净正文回流给上游触发保存。
    const remaining = api.nodes({ at: [] }).length;
    if (remaining === 0) {
      setHasPending(false);
      try {
        const md = serializeMd(editor);
        onResolvedRef.current?.(md);
      } catch (err) {
        // 序列化失败不应吞掉:记录错误,后续用户编辑会再触发 onChange 兜底
        console.error('[proposedEdit] resolveAll 序列化干净正文失败:', err);
      }
    }

    if (import.meta.env.DEV) {
      console.debug(
        `[proposedEdit] resolveAll accept=${accept} ids=${seen.size} remaining=${remaining}`,
      );
    }
  };

  return {
    outcomes,
    hasPending,
    acceptAll: () => resolveAll(true),
    rejectAll: () => resolveAll(false),
  };
}
