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
import { workspaceApi } from '@/services/workspace';
import type { ContentDetail } from '@/services/workspace';
import {
  useDraftEditor,
  type BaseDraftState,
  type DraftEditorAdapter,
} from './lib/use-draft-editor';
import { createNotesDraftAdapter } from './lib/notes-draft-adapter';
import { useWritingAdvisorEnabled } from './lib/use-writing-advisor-enabled';
import { ProseDraftEditor } from './components/ProseDraftEditor';

/* ── notes scope:走 contentItemsApi(notesApi)静态路由,保持现有行为 ────────────── */

const NotesEditPanel = ({ id }: { id: string }) => {
  const agentEnabled = useWritingAdvisorEnabled();

  // 复用共享工厂(学习重写右栏同款),保证两处编辑体验一致。
  const adapter = useMemo(() => createNotesDraftAdapter(id), [id]);

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
  /* 跳进编辑器时调用方在 query 里塞了 at=文集id;
   *   有 at → 编辑的是章节 → 返回路径 = at=文集id & chapter=章节id(左栏定位到章节选中)
   *   无 at → 编辑的是文集本身(卷首语)→ 返回路径 = at=文集id(=本编辑的 id),文集态 */
  const location = useLocation();
  const parentAt = new URLSearchParams(location.search).get('at');

  const adapter = useMemo<DraftEditorAdapter<BaseDraftState>>(
    () => ({
      ready: !!id,
      storageKey: `anthology-${id}`,
      initialState: { title: '', bodyMarkdown: '', changeNote: '' },
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
        // 必须 visibility:'all',否则 controller 走 toPublicDetail 对未发布文集抛 404
        const detail = (await workspaceApi.getById('anthology', id, { visibility: 'all' })) as ContentDetail;
        return {
          title: detail.title,
          bodyMarkdown: detail.bodyMarkdown,
          changeNote: '',
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
      fallbackPath: parentAt
        ? `/admin/anthology?at=${parentAt}&chapter=${id}`
        : `/admin/anthology?at=${id}`,
      labels: { loadError: '加载内容失败' },
    }),
    [id, parentAt],
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
