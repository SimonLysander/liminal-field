/*
 * AnthologyEntryEditPage — 文集条目草稿编辑器
 * 路由：/admin/anthology/:id/entries/:entryKey/edit
 *
 * 与笔记编辑页(../edit.tsx)共用同一套「文稿编辑」骨架(useDraftEditor + ProseDraftEditor)。
 * 本页只提供:
 *   · anthologyAdapter(条目草稿的数据接口 / 标识 id+entryKey)
 *   · agent 上下文(本条目;文集脉络——同集其他条目——后续作为集合上下文注入)
 *
 * 与笔记的差异仅在 adapter:走 anthologyApi 的条目方法、无 summary/changeType 字段、
 * 提交由后端自动删草稿(无需单独 deleteDraft)。
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { anthologyApi } from '@/services/workspace';
import { useDraftEditor, type BaseDraftState, type DraftEditorAdapter } from '../lib/use-draft-editor';
import { useWritingAdvisorEnabled } from '../lib/use-writing-advisor-enabled';
import { ProseDraftEditor } from '../components/ProseDraftEditor';

const AnthologyEntryEditPage = () => {
  const { id, entryKey } = useParams<{ id: string; entryKey: string }>();

  /* AI 顾问:按 writing-advisor 入口配置的 enabled 决定是否渲染 */
  const agentEnabled = useWritingAdvisorEnabled();

  // 整集脉络由后端按 contentItemId(`anthologyId:entryKey`)自查注入(#150 续,2026-05-31)
  // 前端不再 fetch + 拼字符串 + 每轮重发——见 AgentLifecycle.onBeforeChat。

  /* 文集条目场景适配器:条目草稿字段就是 BaseDraftState(无 summary/changeType) */
  const adapter = useMemo<DraftEditorAdapter<BaseDraftState>>(
    () => ({
      ready: !!id && !!entryKey,
      storageKey: id && entryKey ? `${id}:${entryKey}` : null,
      initialState: { title: '', bodyMarkdown: '', changeNote: '更新条目' },
      async loadDraft() {
        const draft = await anthologyApi.getEntryDraft(id!, entryKey!);
        if (!draft) return null;
        return {
          state: { title: draft.title, bodyMarkdown: draft.bodyMarkdown, changeNote: draft.changeNote },
          savedAt: draft.savedAt,
        };
      },
      async loadPublished() {
        const entry = await anthologyApi.getEntry(id!, entryKey!);
        return { title: entry.title, bodyMarkdown: entry.bodyMarkdown, changeNote: '更新条目' };
      },
      async saveDraft(state) {
        const draft = await anthologyApi.saveEntryDraft(id!, entryKey!, {
          title: state.title,
          summary: '',
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        return { savedAt: draft.savedAt };
      },
      async commit(state) {
        // saveEntry 后端会自动删除该条目的草稿
        await anthologyApi.saveEntry(id!, entryKey!, {
          title: state.title,
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
      },
      async discard() {
        await anthologyApi.deleteEntryDraft(id!, entryKey!);
      },
      // 返回/提交后回到「该文集详情」(带 anthologyId),而非文集管理空首页——保留选中上下文
      fallbackPath: id ? `/admin/anthology?anthology=${id}` : '/admin/anthology',
      labels: { loadError: '加载条目失败' },
    }),
    [id, entryKey],
  );

  const editor = useDraftEditor(adapter);

  return (
    <ProseDraftEditor
      editor={editor}
      draftScopeId={id ?? ''}
      editorKey={`anthology-entry-${id}-${entryKey}`}
      titlePlaceholder="条目标题"
      advisor={
        agentEnabled && id && entryKey
          ? {
              enabled: true,
              sessionKey: `anthology-${id}-${entryKey}`,
              contentItemId: `${id}:${entryKey}`,
            }
          : undefined
      }
    />
  );
};

export default AnthologyEntryEditPage;
