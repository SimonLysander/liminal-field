import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { banner } from '@/components/ui/banner-api';
import { useConfirm } from '@/contexts/ConfirmContext';
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

/**
 * 接受 scope 参数复用同一套工作区逻辑(笔记/文集共享 ContentAdmin 壳子,
 * 内部对应不同的 StructureNode 集合)。默认 'notes' 兼容现有调用方。
 * URL query 用通用 'at'(进入哪一层)/'node'(选中哪个内容)而非业务性的 topic/doc。
 */
export function useAdminWorkspace(options: { scope: 'notes' | 'anthology' } = { scope: 'notes' }) {
  const { scope } = options;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();
  const urlFolderId = searchParams.get('at') ?? undefined;
  const urlContentItemId = searchParams.get('node') ?? undefined;

  /* ================================================================
   * 第一层派生：breadcrumb ← API 按 urlFolderId 反查
   * ================================================================ */

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  /* 完整的路径节点（StructureNode[]），用于派生当前文件夹节点 */
  const [pathNodes, setPathNodes] = useState<StructureNode[]>([]);

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
        ? await structureApi.getChildren(parentId, { visibility: 'all', scope })
        : await structureApi.getRootNodes({ visibility: 'all', scope });
      setNodes(result.children);
      // 节点同质化:路径含所有祖先(不再只留 type==='FOLDER'),这样进入任意节点(含叶子)
      // 都能正确显示它自己的正文 + 面包屑,并在它下面新建子页面。
      setPathNodes(result.path);
      setBreadcrumb(result.path.map((n) => ({ id: n.id, name: n.name })));
    } catch (loadError) {
      // parentId 不存在（404）→ 清掉无效 at,fallback 到根节点
      const { isApiError } = await import('@/services/request');
      if (parentId && isApiError(loadError, 404)) {
        searchParams.delete('at');
        setSearchParams(searchParams, { replace: true });
        return;
      }
      setError(parseError(loadError, '加载内容列表失败'));
      setPathNodes([]);
      setBreadcrumb([]);
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSearchParams, scope]);

  /* urlFolderId 变化 → 重新加载当前层级 */
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      await loadLevel(urlFolderId);
    })();
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

  /* 当前浏览的文件夹节点（进入文件夹但未选中文档时有值） */
  const currentFolderNode = useMemo<StructureNode | null>(() => {
    if (!urlFolderId || loading) return null;
    return pathNodes[pathNodes.length - 1] ?? null;
  }, [urlFolderId, loading, pathNodes]);

  /* ================================================================
   * 导航操作：只改 URL，状态自动派生
   * ================================================================ */

  const buildUrl = useCallback((folderId?: string, contentItemId?: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set('at', folderId);
    if (contentItemId) params.set('node', contentItemId);
    const qs = params.toString();
    return qs ? `/admin/${scope}?${qs}` : `/admin/${scope}`;
  }, [scope]);

  const enterFolder = useCallback((node: StructureNode) => {
    navigate(buildUrl(node.id));
  }, [navigate, buildUrl]);

  const goToBreadcrumb = useCallback((index: number | null) => {
    if (index === null) {
      navigate(`/admin/${scope}`);
    } else {
      navigate(buildUrl(breadcrumb[index].id));
    }
  }, [navigate, buildUrl, breadcrumb, scope]);

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

    // 必传 scope:hook 自己知道当前 scope(notes/anthology),后端默认 'notes',
    // 不传会让文集 admin 新建的节点跑进笔记 scope。
    const createPayload = { ...(payload.node as CreateStructureNodeDto), scope };
    const created = await structureApi.createNode(createPayload);
    void loadLevel(urlFolderId);

    // DOC 节点创建后直接跳转编辑页(按 scope 走)
    if (created.type === 'DOC' && created.contentItemId) {
      window.location.href = `/admin/${scope}/${created.contentItemId}/edit`;
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await structureApi.deleteNode(deleteTarget.id);
    } catch (err) {
      banner.error(parseError(err, '删除失败'));
      setDeleteTarget(null);
      return;
    }

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
      // 乐观更新 UI：在 setState updater 外用当前 nodes 快照计算新顺序，
      // 避免在 updater 内修改外部变量（updater 必须纯函数，StrictMode 下会运行两次导致状态错误）。
      const sourceIndex = nodes.findIndex((n) => n.id === nodeId);
      const targetIndex = nodes.findIndex((n) => n.id === targetNodeId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const copy = [...nodes];
      const [moved] = copy.splice(sourceIndex, 1);
      const insertIndex = position === 'before'
        ? copy.findIndex((n) => n.id === targetNodeId)
        : copy.findIndex((n) => n.id === targetNodeId) + 1;
      copy.splice(insertIndex, 0, moved);
      const reorderedIds = copy.map((n) => n.id);

      setNodes(copy);

      void structureApi.reorderSiblings(urlFolderId ?? null, reorderedIds).catch((err) => {
        console.error('[useAdminWorkspace] 排序保存失败:', err);
        // 排序保存失败时回滚乐观更新
        void loadLevel(urlFolderId);
      });
    },
    [nodes, urlFolderId, loadLevel],
  );

  /* ================================================================
   * 跨层级移动
   * ================================================================ */

  const moveNodeToFolder = useCallback(
    async (nodeId: string, targetFolderId: string | null) => {
      await structureApi.updateNode(nodeId, { parentId: targetFolderId });
      // 移动成功后跳转到目标文件夹，让用户直接看到节点在新位置
      const movedNode = nodes.find((n) => n.id === nodeId);
      navigate(
        buildUrl(targetFolderId ?? undefined, movedNode?.contentItemId),
      );
    },
    [nodes, navigate, buildUrl],
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

  /* 用 contentItemId 驱动内容加载（不依赖 selectedNode 引用）。
   * 节点同质化:有子节点的"文件夹"也是一篇笔记——进入它(currentFolderNode)时也加载其自身正文,
   * 右侧统一走 ContentVersionView,不再有文件夹专属视图。doc 优先于当前文件夹。 */
  const activeNode = selectedNode ?? currentFolderNode;
  const activeContentItemId = activeNode?.contentItemId ?? null;
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

      /*
       * Phase 5 优雅降级:anthology scope 下 admin 主页不调 notes 专用的
       * contentItemsApi(否则 404——文集节点不在 notes 表)。
       * 折中策略:右侧 preview/history 暂留空,用户点节点直接进编辑器
       * (/admin/anthology/:id/edit)看完整内容与版本。
       * 长期方案:scope 适配整套通用节点 API,Phase 8 polish 再做。
       */
      if (scope === 'anthology') {
        setFormalContent(EMPTY_FORMAL_CONTENT);
        setDraftState(EMPTY_DRAFT_EDITOR_STATE);
        setHistory([]);
        setDraftPresence(EMPTY_DRAFT_PRESENCE);
        setIsDirty(false);
        setLastDraftSavedAt('');
        setContentLoading(false);
        setHistoryLoading(false);
        return;
      }

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
        // 404（scope 不匹配或不存在）→ 清掉 URL 参数，toast 提示
        const { isApiError } = await import('@/services/request');
        if (isApiError(workspaceError, 404)) {
          banner.error('该内容不属于当前模块');
          navigate(`/admin/${scope}`, { replace: true });
          return;
        }
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
    [probeDraftPresence, navigate, scope],
  );

  /* contentItemId 变化 → 加载内容或重置 */
  useEffect(() => {
    if (activeContentItemId === prevContentItemIdRef.current) return;
    prevContentItemIdRef.current = activeContentItemId;

    let cancelled = false;

    if (!activeContentItemId) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
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
      });
    } else {
      void (async () => {
        await Promise.resolve();
        await loadFormalContent(activeContentItemId);
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [activeContentItemId, loadFormalContent]);

  /* ================================================================
   * 元数据轻量更新（摘要等，不创建新版本）
   *
   * Phase 8 scope 防卫:anthology 模块下用户编辑走 /admin/anthology/:id/edit
   * 专属编辑器,不应该在 ContentAdmin 主页触发草稿/发布/摘要等写操作。
   * 各方法首行 noop 早 return,避免 anthology 节点误命中 notes 专用 API
   * 而 404。
   * ================================================================ */

  const updateSummary = useCallback(
    async (summary: string) => {
      if (scope === 'anthology') return;
      if (!activeContentItemId) return;
      try {
        const detail = await contentItemsApi.patchMeta(activeContentItemId, { summary });
        setFormalContent(toFormalContentState(detail));
      } catch (err) {
        banner.error(`更新摘要失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeContentItemId, scope],
  );

  /* ================================================================
   * 草稿操作
   * ================================================================ */

  const handleDraftEditorChange = useCallback(<K extends keyof DraftEditorState>(
    key: K,
    value: DraftEditorState[K],
  ) => {
    // Phase 8 scope 防卫:anthology 主页不参与草稿编辑(走专属编辑器),屏蔽改动以防误存。
    if (scope === 'anthology') return;
    setDraftState((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
    setAutosaveError('');
  }, [scope]);

  const createDraftFromFormalVersion = useCallback(
    async (overwrite: boolean) => {
      if (scope === 'anthology') return;
      if (!activeContentItemId || !formalContent.id) return;

      if (overwrite && draftPresence.exists) {
        const ok = await confirm({ title: '覆盖草稿', message: '是否覆盖已有草稿？', danger: true });
        if (!ok) return;
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
      confirm,
      draftPresence.exists,
      formalContent.bodyMarkdown,
      formalContent.id,
      formalContent.latestVersion.summary,
      formalContent.latestVersion.title,
      activeContentItemId,
      scope,
    ],
  );

  const resumeDraft = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId) return;

    setContentLoading(true);
    setContentError('');
    try {
      const draft = await contentItemsApi.getDraft(activeContentItemId);
      // getDraft 可能返回 null（无草稿），此时静默退出，不切换到 draft 模式
      if (!draft) {
        setContentError('草稿不存在');
        return;
      }
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
  }, [activeContentItemId, scope]);

  const saveDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (scope === 'anthology') return;
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
      scope,
    ],
  );

  const commitDraft = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId) return;
    try {
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
      // 提交成功，版本历史刷新即为反馈
      setHistory(await contentItemsApi.getHistory(activeContentItemId));
    } catch (err) {
      banner.error(`提交失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [
    draftState.bodyMarkdown,
    draftState.changeNote,
    draftState.changeType,
    draftState.summary,
    draftState.title,
    activeContentItemId,
    scope,
  ]);

  const discardDraft = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId) return;
    try {
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
        headings: formalContent.headings,
        changeLogs: [],
        createdAt: '',
        updatedAt: formalContent.updatedAt,
      }));
      setDraftInfo('');
      setLastDraftSavedAt('');
      setAutosaveError('');
      setIsDirty(false);
      setWorkspaceMode('formal');
      // 丢弃草稿成功（切回 formal 模式即为反馈）
    } catch (err) {
      banner.error(`丢弃草稿失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [formalContent, activeContentItemId, scope]);

  /* ================================================================
   * 发布操作
   * ================================================================ */

  const publishContent = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId) return;
    try {
      const saved = await contentItemsApi.publish(activeContentItemId);
      setFormalContent(toFormalContentState(saved));
      // 发布成功（状态字段变化即为反馈）
    } catch (err) {
      banner.error(`发布失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeContentItemId, scope]);

  const unpublishContent = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId) return;
    try {
      const saved = await contentItemsApi.unpublish(activeContentItemId);
      setFormalContent(toFormalContentState(saved));
      // 取消发布成功（状态字段变化即为反馈）
    } catch (err) {
      banner.error(`取消发布失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeContentItemId, scope]);

  /* ================================================================
   * 版本预览
   * ================================================================ */

  const previewVersion = useCallback(
    async (versionId: string) => {
      if (scope === 'anthology') return;
      if (!activeContentItemId) return;
      if (preview?.versionId === versionId) return;
      // 点击最新版本时退出预览（用 versionId 对比）
      if (versionId === formalContent.latestVersion.versionId) {
        setPreview(null);
        return;
      }

      setPreviewLoading(true);
      try {
        const detail = await contentItemsApi.getByVersion(activeContentItemId, versionId);
        setPreview({
          versionId,
          title: detail.title,
          summary: detail.summary ?? '',
          bodyMarkdown: detail.bodyMarkdown,
          headings: detail.headings,
          committedAt: detail.updatedAt,
        });
      } catch (previewError) {
        setContentError(parseError(previewError, '加载版本内容失败'));
      } finally {
        setPreviewLoading(false);
      }
    },
    [activeContentItemId, preview?.versionId, formalContent.latestVersion.versionId, scope],
  );

  const exitPreview = useCallback(() => { setPreview(null); }, []);

  const publishPreview = useCallback(async () => {
    if (scope === 'anthology') return;
    if (!activeContentItemId || !preview) return;
    try {
      const saved = await contentItemsApi.publish(activeContentItemId, preview.versionId);
      setFormalContent(toFormalContentState(saved));
      setHistory(await contentItemsApi.getHistory(activeContentItemId));
    } catch (err) {
      banner.error(`发布失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeContentItemId, preview, scope]);

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
    currentFolderNode,
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
    updateSummary,
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
