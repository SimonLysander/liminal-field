/**
 * useProposedEditController —— 在 <Plate> context 内,把外部(聊天)传来的 edits
 * 落成 suggestion,并提供"全部接受/全部拒绝"。
 *
 * 设计要点:
 * - 用 lastKeyRef 去重:同一 editsKey 只应用一次,防止 re-render 重复落 suggestion
 * - resolveAll 遍历全文所有 suggestion 节点,每个唯一 suggestionId 只处理一次
 * - 用官方工具函数 getSuggestionKeyId / keyId2SuggestionId 解析节点 id,不手动解析 key
 * - suggestionData() 取 TInlineSuggestionData 填充 TResolvedSuggestion(createdAt 为 number → Date)
 * - @platejs/suggestion 无批量 accept/reject API,逐个调用是唯一方式
 */

import { useEffect, useRef, useState } from 'react';
import { useEditorRef } from 'platejs/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  acceptSuggestion,
  getSuggestionKeyId,
  keyId2SuggestionId,
  rejectSuggestion,
} from '@platejs/suggestion';

import { applyProposedEdits, type EditOutcome, type ProposedEdit } from './apply-proposed-edits';

export function useProposedEditController(
  pendingEdits: ProposedEdit[] | undefined,
  editsKey: string,
) {
  const editor = useEditorRef();
  const [outcomes, setOutcomes] = useState<EditOutcome[]>([]);
  // 去重 guard:记录上一次已应用的 editsKey,同一批 edits 只落一次 suggestion
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!pendingEdits || pendingEdits.length === 0) return;
    if (lastKeyRef.current === editsKey) return;
    lastKeyRef.current = editsKey;
    setOutcomes(applyProposedEdits(editor, pendingEdits));
  }, [editor, pendingEdits, editsKey]);

  /**
   * 遍历全文所有 suggestion 节点,对每个唯一 suggestionId 调用 accept/reject。
   * @platejs/suggestion 无批量 API,逐个是官方推荐做法。
   * 用 getSuggestionKeyId + keyId2SuggestionId 取 id,比手动解析 key 更健壮。
   * suggestionData() 返回 TInlineSuggestionData | TSuggestionElement['suggestion'] | undefined;
   * 两者均含 createdAt(number)、userId、type 字段,统一转换后填入 TResolvedSuggestion。
   */
  const resolveAll = (accept: boolean) => {
    const api = editor.getApi(SuggestionPlugin).suggestion;
    const seen = new Set<string>();

    for (const [node] of api.nodes({ at: [] })) {
      const keyId = getSuggestionKeyId(node);
      if (!keyId) continue;

      const id = keyId2SuggestionId(keyId);
      if (seen.has(id)) continue;
      seen.add(id);

      // suggestionData 取到的可能是 TInlineSuggestionData(inline text)
      // 或 TSuggestionElement['suggestion'](block suggestion),两者字段相同
      const data = api.suggestionData(node);
      const desc = {
        suggestionId: id,
        keyId,
        // TInlineSuggestionData.type 为 'insert'|'remove'|'update',
        // TResolvedSuggestion.type 还支持 'replace',兜底用 'update'
        type: (data?.type ?? 'update') as 'insert' | 'remove' | 'replace' | 'update',
        userId: data?.userId ?? 'aurora',
        // TInlineSuggestionData.createdAt 是 number(timestamp),TResolvedSuggestion 需要 Date
        createdAt: data?.createdAt ? new Date(data.createdAt) : new Date(),
      };

      (accept ? acceptSuggestion : rejectSuggestion)(editor, desc);
    }

    if (import.meta.env.DEV) {
      console.debug(`[proposedEdit] resolveAll accept=${accept} ids=${seen.size}`);
    }
  };

  return {
    outcomes,
    acceptAll: () => resolveAll(true),
    rejectAll: () => resolveAll(false),
  };
}
