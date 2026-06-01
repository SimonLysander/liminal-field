/*
 * DraftEditPage — 节点草稿编辑器(笔记 + 文集子节点共用,Phase 4 起按 URL path 推 scope)
 *
 * 路由:
 *   /admin/notes/:id/edit       → scope='notes' (NotesEditPanel)
 *   /admin/anthology/:id/edit   → scope='anthology' (AnthologyNodeEditPanel)
 *
 * 「文稿编辑」内核(加载/自动保存/提交/丢弃/大纲)全在 useDraftEditor;
 * 三栏布局(顾问|编辑器|大纲)+ 顶栏在 ProseDraftEditor。
 *
 * 设计:两个 scope 状态字段不同(notes 多 summary+changeType),为避免 hook 与类型混用,
 * 拆成两个内部 Panel 组件,DraftEditPage 只做 path → scope 派发,保证只跑一个 useDraftEditor、
 * 类型由 adapter 各自闭合。
 *
 * 笔记 scope 保留 contentItemsApi(notesApi)路径,零改动风险;
 * 文集 scope 走通用节点接口(workspaceApi.getNodeDraft / .getById / .update),
 * 后端 :scope/items/:id/draft 三件套 + 通用 update 已在 Phase 1 commit 落地。
 *
 * Phase 6 会清掉旧 anthology/edit.tsx(基于 entryKey 路径),那时本页接管所有文集子节点编辑。
 */

import { useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import {
  notesApi as contentItemsApi,
  workspaceApi,
} from '@/services/workspace';
import type { ContentChangeType, ContentDetail } from '@/services/workspace';
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

/* ── notes scope:走 contentItemsApi(notesApi)静态路由,保持现有行为 ────────────── */

const NotesEditPanel = ({ id }: { id: string }) => {
  const agentEnabled = useWritingAdvisorEnabled();

  const adapter = useMemo<DraftEditorAdapter<NotesDraftState>>(
    () => ({
      ready: !!id,
      storageKey: id,
      initialState: { title: '', summary: '', bodyMarkdown: '', changeNote: '更新内容', changeType: 'patch' },
      async loadDraft() {
        const draft = await contentItemsApi.getDraft(id);
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
        const detail = await contentItemsApi.getById(id, { visibility: 'all' });
        return {
          title: detail.latestVersion.title,
          summary: detail.latestVersion.summary,
          bodyMarkdown: detail.bodyMarkdown,
          changeNote: '更新内容',
          changeType: 'patch',
        };
      },
      async saveDraft(state) {
        const draft = await contentItemsApi.saveDraft(id, {
          title: state.title,
          summary: state.summary,
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        return { savedAt: draft.savedAt };
      },
      async commit(state) {
        await contentItemsApi.save(id, {
          title: state.title,
          summary: state.summary,
          status: 'committed',
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
          changeType: state.changeType,
          action: 'commit',
        });
        await contentItemsApi.deleteDraft(id); // 提交后清服务端草稿
      },
      async discard() {
        await contentItemsApi.deleteDraft(id);
      },
      fallbackPath: `/admin/notes?node=${id}`,
      labels: { loadError: '加载内容失败' },
    }),
    [id],
  );

  const editor = useDraftEditor(adapter);

  return (
    <ProseDraftEditor
      editor={editor}
      draftScopeId={id}
      editorKey={id}
      titlePlaceholder="无标题"
      advisor={agentEnabled ? { enabled: true, sessionKey: `draft-${id}`, contentItemId: id } : undefined}
    />
  );
};

/* ── anthology scope:走通用节点接口(:scope/items/:id 与 :scope/items/:id/draft) ── */

const AnthologyNodeEditPanel = ({ id }: { id: string }) => {
  const agentEnabled = useWritingAdvisorEnabled();

  const adapter = useMemo<DraftEditorAdapter<BaseDraftState>>(
    () => ({
      ready: !!id,
      storageKey: `anthology-${id}`,
      initialState: { title: '', bodyMarkdown: '', changeNote: '更新内容' },
      async loadDraft() {
        const draft = await workspaceApi.getNodeDraft('anthology', id);
        if (!draft) return null;
        return {
          state: { title: draft.title, bodyMarkdown: draft.bodyMarkdown, changeNote: draft.changeNote },
          savedAt: draft.savedAt,
        };
      },
      async loadPublished() {
        // 通用 GET :scope/items/:id?visibility=all 在 anthology scope 走 toAdminDetail,
        // 返回结构 = { id, title, description, bodyMarkdown, status, hasUnpublishedChanges, entries }。
        // 对 entry 节点,title 来自 latestVersion.title,bodyMarkdown 来自该节点 snapshot 正文。
        // 类型上 workspaceApi.getById 标注为 ContentDetail(notes 形状),anthology 结构兼容这两个字段,
        // 其余字段 DraftEditPage 不消费,as ContentDetail 是契约层的"取 title+bodyMarkdown"窄化。
        const detail = (await workspaceApi.getById('anthology', id)) as ContentDetail;
        return {
          title: detail.title,
          bodyMarkdown: detail.bodyMarkdown,
          changeNote: '更新内容',
        };
      },
      async saveDraft(state) {
        const draft = await workspaceApi.saveNodeDraft('anthology', id, {
          title: state.title,
          summary: '',
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        return { savedAt: draft.savedAt };
      },
      async commit(state) {
        // 通用 update 内部走 ContentSaveAction.commit,只更新 latestVersion,不动 publishedVersion;
        // 通用 update 不会自动删草稿,故 commit 后显式 deleteNodeDraft。
        await workspaceApi.update('anthology', id, {
          title: state.title,
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        await workspaceApi.deleteNodeDraft('anthology', id);
      },
      async discard() {
        await workspaceApi.deleteNodeDraft('anthology', id);
      },
      fallbackPath: `/admin/anthology?node=${id}`,
      labels: { loadError: '加载内容失败' },
    }),
    [id],
  );

  const editor = useDraftEditor(adapter);

  return (
    <ProseDraftEditor
      editor={editor}
      draftScopeId={id}
      editorKey={`anthology-${id}`}
      titlePlaceholder="条目标题"
      advisor={agentEnabled ? { enabled: true, sessionKey: `anthology-draft-${id}`, contentItemId: id } : undefined}
    />
  );
};

/**
 * 入口组件:按 URL path 推断 scope,分派到对应的 Panel。
 * 拆分原因:两个 scope 的 DraftState 类型不同(notes 多 summary/changeType),
 * 必须在 hook 调用前用条件渲染选定;同时避免一个组件里跑两套 useDraftEditor + 数据请求。
 */
const DraftEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  /* /admin/anthology/:id/edit → anthology;其余(/admin/notes/:id/edit)视为 notes */
  const scope: 'notes' | 'anthology' = location.pathname.startsWith('/admin/anthology/')
    ? 'anthology'
    : 'notes';

  if (!id) {
    return null;
  }

  return scope === 'anthology'
    ? <AnthologyNodeEditPanel id={id} />
    : <NotesEditPanel id={id} />;
};

export default DraftEditPage;
