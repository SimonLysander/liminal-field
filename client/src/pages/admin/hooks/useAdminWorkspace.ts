import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type {
  CreateStructureNodeDto,
  StructureNode,
  UpdateStructureNodeDto,
} from '@/services/structure';
import { structureApi } from '@/services/structure';
import { parseError } from '../helpers';
import {
  EMPTY_DRAFT_EDITOR_STATE,
  EMPTY_DRAFT_PRESENCE,
  EMPTY_FORMAL_CONTENT,
  type DraftEditorState,
  type ModalState,
  type NodeSubmitPayload,
  type PreviewState,
  type WorkspaceMode,
  toDraftEditorStateFromDetail,
  toDraftEditorStateFromDraft,
  toFormalContentState,
} from '../types';
import type { BreadcrumbItem } from '../components/AdminStructurePanel';

/* ================================================================
 * useAdminWorkspace — 管理端内容工作区核心 Hook
 *
 * 状态模型：URL 是唯一 source of truth
 *   URL (folderId, contentItemId)
 *     → breadcrumb   ← API 按 folderId 反查路径
 *     → nodes        ← API 按 folderId 加载当前层级
 *     → selectedNode ← useMemo 从 nodes + contentItemId 派生
 *     → content      ← effect 按 selectedNode.contentItemId 加载
 *
 * 所有导航操作（enterFolder / goToBreadcrumb / selectNode）
 * 只调 navigate()，不直接 setState。状态自动从 URL 派生。
 * ================================================================ */

export function useAdminWorkspace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlFolderId = searchParams.get('topic') ?? undefined;
  const urlContentItemId = searchParams.get('doc') ?? undefined;

  /* ================================================================
   * 第一层派生：breadcrumb ← API 按 urlFolderId 反查
   * ================================================================ */

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  /* ================================================================
   * 节点列表 + 面包屑：一次请求同时获取 path 和 children
   * ================================================================ */

  const [nodes, setNodes] = useState<StructureNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLevel = useCallback(async (parentId: string | undefined) => {
    setLoading(true);
    setError('');
    try {
      const result = parentId
        ? await structureApi.getChildren(parentId, { visibility: 'all' })
        : await structureApi.getRootNodes({ visibility: 'all' });
      setNodes(result.children);
      setBreadcrumb(
        result.path
          .filter((n) => n.type === 'FOLDER')
          .map((n) => ({ id: n.id, name: n.name })),
      );
    } catch (loadError) {
      setError(parseError(loadError, '加载内容列表失败'));
      setBreadcrumb([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /* urlFolderId 变化 → 重新加载当前层级 */
  useEffect(() => {
    void loadLevel(urlFolderId);
  }, [loadLevel, urlFolderId]);

  const reloadLevel = useCallback(() => {
    void loadLevel(urlFolderId);
  }, [loadLevel, urlFolderId]);

  /* ================================================================
   * 第三层派生：selectedNode ← useMemo 从 nodes + urlContentItemId 查找
   * ================================================================ */

  const selectedNode = useMemo<StructureNode | null>(() => {
    if (!urlContentItemId || loading) return null;
    return nodes.find((n) => n.contentItemId === urlContentItemId) ?? null;
  }, [nodes, urlContentItemId, loading]);

  /* ================================================================
   * 导航操作：只改 URL，状态自动派生
   * ================================================================ */

  const buildUrl = useCallback((folderId?: string, contentItemId?: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set('topic', folderId);
    if (contentItemId) params.set('doc', contentItemId);
    const qs = params.toString();
    return qs ? `/admin/notes?${qs}` : '/admin/notes';
  }, []);

  const enterFolder = useCallback((node: StructureNode) => {
    navigate(buildUrl(node.id));
  }, [navigate, buildUrl]);

  const goToBreadcrumb = useCallback((index: number | null) => {
    if (index === null) {
      navigate('/admin/notes');
    } else {
      navigate(buildUrl(breadcrumb[index].id));
    }
  }, [navigate, buildUrl, breadcrumb]);

  const selectNode = useCallback((node: StructureNode | null) => {
    if (node?.contentItemId) {
      navigate(buildUrl(urlFolderId, node.contentItemId), { replace: true });
    } else {
      navigate(buildUrl(urlFolderId), { replace: true });
    }
  }, [navigate, buildUrl, urlFolderId]);

  /* ================================================================
   * 节点 CRUD
   * ================================================================ */

  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });
  const [deleteTarget, setDeleteTarget] = useState<StructureNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<StructureNode | null>(null);

  const openCreate = (parentId?: string) =>
    setModal({ open: true, mode: 'create', parentId });
  const openEdit = (node: StructureNode) =>
    setModal({ open: true, mode: 'edit', node });
  const closeModal = () => setModal({ open: false, mode: 'create' });

  const handleCreateOrEdit = async (payload: NodeSubmitPayload) => {
    if (modal.mode === 'edit' && modal.node) {
      await structureApi.updateNode(
        modal.node.id,
        payload.node as UpdateStructureNodeDto,
      );
      void loadLevel(urlFolderId);
      return;
    }

    const createPayload = payload.node as CreateStructureNodeDto;
    const created = await structureApi.createNode(createPayload);
    void loadLevel(urlFolderId);

    // DOC 节点创建后直接跳转编辑页
    if (created.type === 'DOC' && created.contentItemId) {
      window.location.href = `/admin/notes/${created.contentItemId}/edit`;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await structureApi.deleteNode(deleteTarget.id);

    /* 如果删的是当前选中的，清除 URL 中的 contentItemId */
    if (selectedNode?.id === deleteTarget.id) {
      navigate(buildUrl(urlFolderId), { replace: true });
    }
    setDeleteTarget(null);
    void loadLevel(urlFolderId);
  };

  /* ================================================================
   * 同级拖拽排序
   * ================================================================ */

  const reorderNodes = useCallback(
    (nodeId: string, targetNodeId: string, position: 'before' | 'after') => {
      // 乐观更新 UI，然后在外部发 API 请求（不在 setState updater 内做副作用）
      let reorderedIds: string[] = [];

      setNodes((current) => {
        const sourceIndex = current.findIndex((n) => n.id === nodeId);
        const targetIndex = current.findIndex((n) => n.id === targetNodeId);
        if (sourceIndex === -1 || targetIndex === -1) return current;

        const copy = [...current];
        const [moved] = copy.splice(sourceIndex, 1);
        const insertIndex = position === 'before'
          ? copy.findIndex((n) => n.id === targetNodeId)
          : copy.findIndex((n) => n.id === targetNodeId) + 1;
        copy.splice(insertIndex, 0, moved);
        reorderedIds = copy.map((n) => n.id);
        return copy;
      });

      if (reorderedIds.length > 0) {
        void structureApi.reorderSiblings(urlFolderId ?? null, reorderedIds).catch(() => {
          void loadLevel(urlFolderId);
        });
      }
    },
    [urlFolderId, loadLevel],
  );

  /* ================================================================
   * 跨层级移动
   * ================================================================ */

  const moveNodeToFolder = useCallback(
    async (nodeId: string, targetFolderId: string | null) => {
      await structureApi.updateNode(nodeId, { parentId: targetFolderId });
      void loadLevel(urlFolderId);
    },
    [urlFolderId, loadLevel],
  );

  /* ================================================================
   * 内容工作区状态
   * ================================================================ */

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('formal');
  const [formalContent, setFormalContent] = useState(EMPTY_FORMAL_CONTENT);
  const [draftState, setDraftState] = useState(EMPTY_DRAFT_EDITOR_STATE);
  const [draftPresence, setDraftPresence] = useState(EMPTY_DRAFT_PRESENCE);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState('');
  const [draftInfo, setDraftInfo] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState('');
  const [autosaveError, setAutosaveError] = useState('');
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof contentItemsApi.getHistory>>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  /* 用 contentItemId 驱动内容加载（不依赖 selectedNode 引用） */
  const activeContentItemId = selectedNode?.contentItemId ?? null;
  const prevContentItemIdRef = useRef<string | null>(null);

  const probeDraftPresence = useCallback(async (contentItemId: string) => {
    const draft = await contentItemsApi.getDraft(contentItemId);
    if (draft) {
      setDraftPresence({ exists: true, savedAt: draft.savedAt });
    } else {
      setDraftPresence(EMPTY_DRAFT_PRESENCE);
    }
    return draft;
  }, []);

  const loadFormalContent = useCallback(
    async (contentItemId: string) => {
      setWorkspaceMode('formal');
      setContentLoading(true);
      setContentError('');
      setDraftInfo('');
      setHistoryLoading(true);

      try {
        const [detail, historyResult, existingDraft] =
          await Promise.all([
            contentItemsApi.getById(contentItemId, { visibility: 'all' }),
            contentItemsApi.getHistory(contentItemId),
            probeDraftPresence(contentItemId),
          ]);

        setFormalContent(toFormalContentState(detail));
        setDraftState(toDraftEditorStateFromDetail(detail));
        setHistory(historyResult);
        setIsDirty(false);
        setLastDraftSavedAt(existingDraft?.savedAt ?? '');
        setAutosaveError('');
      } catch (workspaceError) {
        setContentError(parseError(workspaceError, '加载正式内容失败'));
        setFormalContent(EMPTY_FORMAL_CONTENT);
        setDraftState(EMPTY_DRAFT_EDITOR_STATE);
        setHistory([]);
        setDraftPresence(EMPTY_DRAFT_PRESENCE);
        setIsDirty(false);
        setLastDraftSavedAt('');
      } finally {
        setContentLoading(false);
        setHistoryLoading(false);
      }
    },
    [probeDraftPresence],
  );

  /* contentItemId 变化 → 加载内容或重置 */
  useEffect(() => {
    if (activeContentItemId === prevContentItemIdRef.current) return;
    prevContentItemIdRef.current = activeContentItemId;

    if (!activeContentItemId) {
      setWorkspaceMode('formal');
      setFormalContent(EMPTY_FORMAL_CONTENT);
      setDraftState(EMPTY_DRAFT_EDITOR_STATE);
      setDraftPresence(EMPTY_DRAFT_PRESENCE);
      setContentError('');
      setDraftInfo('');
      setHistory([]);
      setIsDirty(false);
      setIsAutosaving(false);
      setLastDraftSavedAt('');
      setAutosaveError('');
      setHistoryLoading(false);
      setPreview(null);
      return;
    }

    void loadFormalContent(activeContentItemId);
  }, [activeContentItemId, loadFormalContent]);

  /* ================================================================
   * 草稿操作
   * ================================================================ */

  const handleDraftEditorChange = useCallback(<K extends keyof DraftEditorState>(
    key: K,
    value: DraftEditorState[K],
  ) => {
    setDraftState((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
    setAutosaveError('');
  }, []);

  const createDraftFromFormalVersion = useCallback(
    async (overwrite: boolean) => {
      if (!activeContentItemId || !formalContent.id) return;

      if (overwrite && draftPresence.exists) {
        const confirmed = window.confirm('是否覆盖已有草稿？');
        if (!confirmed) return;
      }

      const draft = await contentItemsApi.saveDraft(activeContentItemId, {
        title: formalContent.latestVersion.title,
        summary: formalContent.latestVersion.summary,
        bodyMarkdown: formalContent.bodyMarkdown,
        changeNote: overwrite ? '从正式版本覆盖草稿' : '从正式版本创建草稿',
      });

      setDraftState(toDraftEditorStateFromDraft(draft));
      setDraftPresence({ exists: true, savedAt: draft.savedAt });
      setLastDraftSavedAt(draft.savedAt);
      setDraftInfo(`草稿工作区已就绪 ${new Date(draft.savedAt).toLocaleString('zh-CN')}`);
      setAutosaveError('');
      setIsDirty(false);
      setWorkspaceMode('draft');
    },
    [
      draftPresence.exists,
      formalContent.bodyMarkdown,
      formalContent.id,
      formalContent.latestVersion.summary,
      formalContent.latestVersion.title,
      activeContentItemId,
    ],
  );

  const resumeDraft = useCallback(async () => {
    if (!activeContentItemId) return;

    setContentLoading(true);
    setContentError('');
    try {
      const draft = await contentItemsApi.getDraft(activeContentItemId);
      setDraftState(toDraftEditorStateFromDraft(draft));
      setDraftPresence({ exists: true, savedAt: draft.savedAt });
      setLastDraftSavedAt(draft.savedAt);
      setDraftInfo(`已恢复草稿 ${new Date(draft.savedAt).toLocaleString('zh-CN')}`);
      setAutosaveError('');
      setIsDirty(false);
      setWorkspaceMode('draft');
    } catch (draftError) {
      setContentError(parseError(draftError, '恢复草稿失败'));
    } finally {
      setContentLoading(false);
    }
  }, [activeContentItemId]);

  const saveDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!activeContentItemId) return;

      if (options?.silent) {
        setIsAutosaving(true);
        setAutosaveError('');
      }

      const draft = await contentItemsApi.saveDraft(activeContentItemId, {
        title: draftState.title,
        summary: draftState.summary,
        bodyMarkdown: draftState.bodyMarkdown,
        changeNote: draftState.changeNote,
      });

      setDraftPresence({ exists: true, savedAt: draft.savedAt });
      setIsDirty(false);
      setLastDraftSavedAt(draft.savedAt);

      if (options?.silent) {
        setDraftInfo('');
        setIsAutosaving(false);
        return;
      }

      setDraftInfo(`草稿已保存 ${new Date(draft.savedAt).toLocaleString('zh-CN')}`);
      setIsAutosaving(false);
    },
    [
      draftState.bodyMarkdown,
      draftState.changeNote,
      draftState.summary,
      draftState.title,
      activeContentItemId,
    ],
  );

  const commitDraft = useCallback(async () => {
    if (!activeContentItemId) return;

    const saved = await contentItemsApi.save(activeContentItemId, {
      title: draftState.title,
      summary: draftState.summary,
      status: 'committed',
      bodyMarkdown: draftState.bodyMarkdown,
      changeNote: draftState.changeNote,
      changeType: draftState.changeType,
      action: 'commit',
    });

    await contentItemsApi.deleteDraft(activeContentItemId);

    setFormalContent(toFormalContentState(saved));
    setDraftPresence(EMPTY_DRAFT_PRESENCE);
    setDraftState(toDraftEditorStateFromDetail(saved));
    setDraftInfo('');
    setIsDirty(false);
    setLastDraftSavedAt('');
    setAutosaveError('');
    setWorkspaceMode('formal');
    toast.success(`新版本已提交 ${new Date(saved.updatedAt).toLocaleString('zh-CN')}`);
    setHistory(await contentItemsApi.getHistory(activeContentItemId));
  }, [
    draftState.bodyMarkdown,
    draftState.changeNote,
    draftState.changeType,
    draftState.summary,
    draftState.title,
    activeContentItemId,
  ]);

  const discardDraft = useCallback(async () => {
    if (!activeContentItemId) return;

    await contentItemsApi.deleteDraft(activeContentItemId);
    setDraftPresence(EMPTY_DRAFT_PRESENCE);
    setDraftState(toDraftEditorStateFromDetail({
      id: formalContent.id,
      title: formalContent.latestVersion.title,
      summary: formalContent.latestVersion.summary,
      status: formalContent.status,
      latestVersion: formalContent.latestVersion,
      publishedVersion: formalContent.publishedVersion,
      hasUnpublishedChanges: formalContent.hasUnpublishedChanges,
      bodyMarkdown: formalContent.bodyMarkdown,
      plainText: '',
      assetRefs: [],
      changeLogs: [],
      createdAt: '',
      updatedAt: formalContent.updatedAt,
    }));
    setDraftInfo('');
    setLastDraftSavedAt('');
    setAutosaveError('');
    setIsDirty(false);
    setWorkspaceMode('formal');
    toast.success('草稿已丢弃');
  }, [formalContent, activeContentItemId]);

  /* ================================================================
   * 发布操作
   * ================================================================ */

  const publishContent = useCallback(async () => {
    if (!activeContentItemId) return;
    const saved = await contentItemsApi.publish(activeContentItemId);
    setFormalContent(toFormalContentState(saved));
    toast.success(`内容已发布 ${new Date(saved.updatedAt).toLocaleString('zh-CN')}`);
  }, [activeContentItemId]);

  const unpublishContent = useCallback(async () => {
    if (!activeContentItemId) return;
    const saved = await contentItemsApi.unpublish(activeContentItemId);
    setFormalContent(toFormalContentState(saved));
    toast.success(`已取消发布 ${new Date(saved.updatedAt).toLocaleString('zh-CN')}`);
  }, [activeContentItemId]);

  /* ================================================================
   * 版本预览
   * ================================================================ */

  const previewVersion = useCallback(
    async (commitHash: string) => {
      if (!activeContentItemId) return;
      if (preview?.commitHash === commitHash) return;
      if (commitHash === formalContent.latestVersion.commitHash) {
        setPreview(null);
        return;
      }

      setPreviewLoading(true);
      try {
        const detail = await contentItemsApi.getByVersion(activeContentItemId, commitHash);
        setPreview({
          commitHash,
          title: detail.title,
          bodyMarkdown: detail.bodyMarkdown,
          committedAt: detail.updatedAt,
        });
      } catch (previewError) {
        setContentError(parseError(previewError, '加载版本内容失败'));
      } finally {
        setPreviewLoading(false);
      }
    },
    [activeContentItemId, preview?.commitHash, formalContent.latestVersion.commitHash],
  );

  const exitPreview = useCallback(() => { setPreview(null); }, []);

  const publishPreview = useCallback(async () => {
    if (!activeContentItemId || !preview) return;

    const confirmed = window.confirm(`发布版本 ${preview.commitHash.slice(0, 8)} ？`);
    if (!confirmed) return;

    const saved = await contentItemsApi.save(activeContentItemId, {
      title: preview.title,
      summary: formalContent.latestVersion.summary,
      status: 'published',
      bodyMarkdown: preview.bodyMarkdown,
      changeNote: `发布版本 ${preview.commitHash.slice(0, 8)}`,
      changeType: 'patch',
      action: 'publish',
    });

    setFormalContent(toFormalContentState(saved));
    setPreview(null);
    toast.success(`版本 ${preview.commitHash.slice(0, 8)} 已发布`);
    setHistory(await contentItemsApi.getHistory(activeContentItemId));
  }, [activeContentItemId, preview, formalContent.latestVersion.summary]);

  /* ================================================================
   * 自动保存
   * ================================================================ */

  useEffect(() => {
    if (workspaceMode !== 'draft' || !activeContentItemId || !isDirty || contentLoading) return;

    const timer = window.setTimeout(() => {
      void saveDraft({ silent: true }).catch((autosaveFailure) => {
        setIsAutosaving(false);
        setAutosaveError(parseError(autosaveFailure, '自动保存失败'));
      });
    }, 1500);

    return () => { window.clearTimeout(timer); };
  }, [contentLoading, isDirty, saveDraft, activeContentItemId, workspaceMode]);

  /* ================================================================
   * 返回值
   * ================================================================ */

  return {
    /* 导航（URL 驱动） */
    breadcrumb,
    nodes,
    loading,
    error,
    currentParentId: urlFolderId,
    enterFolder,
    goToBreadcrumb,
    reloadLevel,

    /* 节点选择 & CRUD */
    selectedNode,
    selectNode,
    modal,
    deleteTarget,
    setDeleteTarget,
    moveTarget,
    setMoveTarget,
    openCreate,
    openEdit,
    closeModal,
    handleCreateOrEdit,
    handleDelete,

    /* 排序 & 移动 */
    reorderNodes,
    moveNodeToFolder,

    /* 内容工作区 */
    /** 同步清空预览内容，立即卸载 PlateReadOnly。导航到编辑页前调用。 */
    clearContent: useCallback(() => {
      setFormalContent(EMPTY_FORMAL_CONTENT);
      setPreview(null);
    }, []),
    workspaceMode,
    formalContent,
    draftState,
    draftPresence,
    contentLoading,
    contentError,
    draftInfo,
    isDirty,
    isAutosaving,
    lastDraftSavedAt,
    autosaveError,
    history,
    historyLoading,
    loadFormalContent,
    handleDraftEditorChange,
    createDraftFromFormalVersion,
    resumeDraft,
    saveDraft,
    commitDraft,
    discardDraft,
    publishContent,
    unpublishContent,
    preview,
    previewLoading,
    previewVersion,
    exitPreview,
    publishPreview,
    setWorkspaceMode,
  };
}
