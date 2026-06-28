/*
 * createNotesDraftAdapter — notes scope 的草稿编辑 adapter 工厂。
 *
 * 抽出来给「编辑草稿页(DraftEditPage)」和「学习重写右栏」共用,保证两处编辑体验完全一致:
 * 无草稿先读已发布正文(loadPublished)、首次真实编辑才 upsert 出草稿、1.5s 自动保存、提交版本。
 * 之前学习页手搓了一套简陋保存,现统一到这里。
 */

import { notesApi, type ContentChangeType } from '@/services/workspace';
import type { BaseDraftState, DraftEditorAdapter } from './use-draft-editor';

export interface NotesDraftState extends BaseDraftState {
  summary: string;
  changeType: ContentChangeType;
}

export function createNotesDraftAdapter(
  id: string,
): DraftEditorAdapter<NotesDraftState> {
  return {
    ready: !!id,
    storageKey: id,
    initialState: {
      title: '',
      summary: '',
      bodyMarkdown: '',
      changeNote: '',
      changeType: 'patch',
    },
    async loadDraft() {
      const draft = await notesApi.getDraft(id);
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
    // 无草稿时回退到已发布正文(老节点只有发布过的正文、没草稿/AI稿,靠这步才不至于显示空白)
    async loadPublished() {
      const detail = await notesApi.getById(id, { visibility: 'all' });
      return {
        title: detail.latestVersion.title,
        summary: detail.latestVersion.summary,
        bodyMarkdown: detail.bodyMarkdown,
        changeNote: '',
        changeType: 'patch',
      };
    },
    async saveDraft(state) {
      const draft = await notesApi.saveDraft(id, {
        title: state.title,
        summary: state.summary,
        bodyMarkdown: state.bodyMarkdown,
        changeNote: state.changeNote,
      });
      return { savedAt: draft.savedAt };
    },
    async commit(state) {
      await notesApi.save(id, {
        title: state.title,
        summary: state.summary,
        status: 'committed',
        bodyMarkdown: state.bodyMarkdown,
        changeNote: state.changeNote,
        changeType: state.changeType,
        action: 'commit',
      });
      await notesApi.deleteDraft(id); // 提交后清服务端草稿
    },
    async discard() {
      await notesApi.deleteDraft(id);
    },
    fallbackPath: `/admin/notes?node=${id}`,
    labels: { loadError: '加载内容失败' },
  };
}
