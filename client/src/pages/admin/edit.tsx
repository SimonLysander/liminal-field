/*
 * DraftEditPage — 笔记草稿编辑器 (/admin/notes/:id/edit)
 *
 * 「文稿编辑」内核(加载/自动保存/提交/丢弃/大纲)全在 useDraftEditor;
 * 三栏布局(顾问|编辑器|大纲)+ 顶栏在 ProseDraftEditor。本页只提供:
 *   · notesAdapter(笔记的数据接口 / 标识 / 透传字段 summary+changeType)
 *   · agent 上下文(本篇笔记)
 * 与文集条目编辑页(anthology/edit.tsx)共用同一套骨架。
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentChangeType } from '@/services/workspace';
import {
  useDraftEditor,
  type BaseDraftState,
  type DraftEditorAdapter,
} from './lib/use-draft-editor';
import { useWritingAdvisorEnabled } from './lib/use-writing-advisor-enabled';
import { ProseDraftEditor } from './components/ProseDraftEditor';

/** 笔记草稿:在基础字段上多 summary(摘要)+ changeType(变更类型),二者透传不在 UI 编辑 */
interface NotesDraftState extends BaseDraftState {
  summary: string;
  changeType: ContentChangeType;
}

const DraftEditPage = () => {
  const { id } = useParams<{ id: string }>();

  /* AI 顾问:按 writing-advisor 入口配置的 enabled 决定是否渲染 */
  const agentEnabled = useWritingAdvisorEnabled();

  /* 笔记场景适配器:把数据接口/标识/透传字段注入「文稿编辑」内核 */
  const adapter = useMemo<DraftEditorAdapter<NotesDraftState>>(
    () => ({
      ready: !!id,
      storageKey: id ?? null,
      initialState: { title: '', summary: '', bodyMarkdown: '', changeNote: '更新内容', changeType: 'patch' },
      async loadDraft() {
        const draft = await contentItemsApi.getDraft(id!);
        if (!draft) return null;
        return {
          state: {
            title: draft.title,
            summary: draft.summary,
            bodyMarkdown: draft.bodyMarkdown,
            changeNote: draft.changeNote,
            changeType: 'patch',
          },
          savedAt: draft.savedAt,
        };
      },
      async loadPublished() {
        const detail = await contentItemsApi.getById(id!, { visibility: 'all' });
        return {
          title: detail.latestVersion.title,
          summary: detail.latestVersion.summary,
          bodyMarkdown: detail.bodyMarkdown,
          changeNote: '更新内容',
          changeType: 'patch',
        };
      },
      async saveDraft(state) {
        const draft = await contentItemsApi.saveDraft(id!, {
          title: state.title,
          summary: state.summary,
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        return { savedAt: draft.savedAt };
      },
      async commit(state) {
        await contentItemsApi.save(id!, {
          title: state.title,
          summary: state.summary,
          status: 'committed',
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
          changeType: state.changeType,
          action: 'commit',
        });
        await contentItemsApi.deleteDraft(id!); // 提交后清服务端草稿
      },
      async discard() {
        await contentItemsApi.deleteDraft(id!);
      },
      // 返回/提交后回到「该文档详情」(带 node 参数),而非内容管理空首页——保留选中上下文
      fallbackPath: id ? `/admin/notes?node=${id}` : '/admin/notes',
      labels: { loadError: '加载内容失败' },
    }),
    [id],
  );

  const editor = useDraftEditor(adapter);

  return (
    <ProseDraftEditor
      editor={editor}
      draftScopeId={id ?? ''}
      editorKey={id ?? 'new'}
      titlePlaceholder="无标题"
      advisor={agentEnabled && id ? { enabled: true, sessionKey: `draft-${id}`, contentItemId: id } : undefined}
    />
  );
};

export default DraftEditPage;
