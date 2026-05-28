/*
 * AnthologyAdmin — 文集管理主页面 (/admin/anthology)
 *
 * 三栏布局，两级视图（参照 Notes ContentAdmin）：
 *
 * 第一级（选中文集 → 条目列表）：
 *   左栏：文集列表
 *   中栏：选中文集的条目列表 + 标题行操作按钮（发布文集 / ... dropdown）
 *   右栏：文集概览（描述、条目数）— 无操作按钮
 *
 * 第二级（点击条目 → 条目预览）：
 *   左栏：文集列表（不变）
 *   中栏：条目内容预览 + 标题行操作按钮（发布条目 / ... dropdown）
 *   右栏：编辑（草稿状态 + 继续编辑/覆盖重建）+ 版本时间线
 *
 * URL 驱动：
 *   ?anthology=ci_xxx            → 选中文集，显示第一级
 *   ?anthology=ci_xxx&entry=e001 → 选中条目，显示第二级
 *
 * 编辑跳转用 window.location.href（Plate editor inputRules 在 SPA 导航后不生效，
 * 必须硬刷新，参见 CLAUDE.md 踩坑记录）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';

import Topbar from '@/components/global/Topbar';
import { LoadingState } from '@/components/LoadingState';
import { useConfirm } from '@/contexts/ConfirmContext';
import { smoothBounce } from '@/lib/motion';
import {
  anthologyApi,
  type AnthologyAdminListItem,
  type AnthologyAdminDetail,
  type AnthologyEntryDetail,
  type ContentHistoryEntry,
  type EditorDraft,
} from '@/services/workspace';

import { AnthologyList } from './components/AnthologyList';
import { EntryListPanel } from './components/EntryListPanel';
import { EntryPreviewPanel } from './components/EntryPreviewPanel';
import { AnthologySidePanel } from './components/AnthologySidePanel';
import { EntrySidePanel } from './components/EntrySidePanel';
import { EmptyState } from './components/primitives';

// ─── 主组件 ───

export default function AnthologyAdmin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();

  const [anthologies, setAnthologies] = useState<AnthologyAdminListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  /* 文集详情 */
  const [detail, setDetail] = useState<AnthologyAdminDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* 条目预览（第二级视图） */
  const [entryContent, setEntryContent] = useState<AnthologyEntryDetail | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);

  /* 条目右侧面板数据 */
  const [entryDraft, setEntryDraft] = useState<EditorDraft | null>(null);
  const [entryDraftLoading, setEntryDraftLoading] = useState(false);
  const [entryHistory, setEntryHistory] = useState<ContentHistoryEntry[]>([]);
  const [entryHistoryLoading, setEntryHistoryLoading] = useState(false);
  const [entryPublishing, setEntryPublishing] = useState(false);

  /* 版本预览：点击版本时间线后，中栏显示历史版本内容而非最新版本 */
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<AnthologyEntryDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  /*
   * URL 参数：?anthology=id&entry=eXXX 驱动当前视图状态。
   * 不使用 useState 管理选中状态，URL 是唯一数据源（与 Notes ContentAdmin 一致）。
   */
  const selectedId = searchParams.get('anthology');
  const selectedEntryKey = searchParams.get('entry');

  const setSelectedId = useCallback(
    (id: string | null) => {
      setSearchParams(id ? { anthology: id } : {}, { replace: true });
    },
    [setSearchParams],
  );

  const setSelectedEntry = useCallback(
    (entryKey: string | null) => {
      if (!selectedId) return;
      if (entryKey) {
        setSearchParams({ anthology: selectedId, entry: entryKey }, { replace: true });
      } else {
        setSearchParams({ anthology: selectedId }, { replace: true });
      }
    },
    [selectedId, setSearchParams],
  );

  // ─── 数据加载 ───

  const loadAnthologies = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await anthologyApi.list();
      setAnthologies(data);
      /* 若当前选中的文集已不在列表中，清空 URL */
      const currentId = searchParams.get('anthology');
      if (currentId && !data.some((a) => a.id === currentId)) {
        setSelectedId(null);
      }
    } catch {
      banner.error('加载失败，请重试');
    } finally {
      setListLoading(false);
    }
  }, [searchParams, setSelectedId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await loadAnthologies();
    })();
    return () => { cancelled = true; };
  }, [loadAnthologies]);

  /* 选中文集时加载详情 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!selectedId) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      try {
        const d = await anthologyApi.getById(selectedId);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetail(null);
        banner.error('加载文集详情失败');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  /* 选中条目时加载条目内容、草稿、版本历史；同时清空上一条目的版本预览状态 */
  useEffect(() => {
    // 切换条目时立即清空版本预览，避免闪烁展示旧条目的历史内容
    // 清空与紧随的异步加载属同一逻辑单元，刻意放 effect（拆分会损害可读性）
    /* eslint-disable react-hooks/set-state-in-effect */
    setPreviewVersionId(null);
    setPreviewContent(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!selectedId || !selectedEntryKey) {
        setEntryContent(null);
        setEntryDraft(null);
        setEntryHistory([]);
        return;
      }

      /* 并行加载：条目内容 + 草稿 + 版本历史 */
      setEntryLoading(true);
      setEntryDraftLoading(true);
      setEntryHistoryLoading(true);

      const [contentResult, draftResult, historyResult] = await Promise.allSettled([
        anthologyApi.getEntry(selectedId, selectedEntryKey),
        anthologyApi.getEntryDraft(selectedId, selectedEntryKey),
        anthologyApi.getEntryHistory(selectedId, selectedEntryKey),
      ]);

      if (cancelled) return;

      if (contentResult.status === 'fulfilled') {
        setEntryContent(contentResult.value);
      } else {
        setEntryContent(null);
        banner.error('加载条目内容失败');
      }
      setEntryLoading(false);

      if (draftResult.status === 'fulfilled') {
        setEntryDraft(draftResult.value);
      }
      setEntryDraftLoading(false);

      if (historyResult.status === 'fulfilled') {
        setEntryHistory(historyResult.value);
      }
      setEntryHistoryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, selectedEntryKey]);

  // ─── 操作处理 ───

  const handleCreate = async (title: string) => {
    await anthologyApi.create({ title });
    await loadAnthologies();
  };

  /**
   * 版本时间线点击处理：切换中栏预览的历史版本。
   * - 再次点击同一版本 → 退出预览（回到最新版本内容）
   * - 点击新版本 → 加载该历史 snapshot 并展示
   */
  const handleSelectVersion = async (versionId: string) => {
    if (!selectedId || !selectedEntryKey) return;
    // 再次点击当前预览版本 → 退出预览
    if (previewVersionId === versionId) {
      setPreviewVersionId(null);
      setPreviewContent(null);
      return;
    }
    setPreviewVersionId(versionId);
    setPreviewLoading(true);
    try {
      const content = await anthologyApi.getEntryByVersion(selectedId, selectedEntryKey, versionId);
      setPreviewContent(content);
    } catch {
      banner.error('加载历史版本失败');
      setPreviewVersionId(null);
      setPreviewContent(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  /**
   * 文集详情刷新：由子组件操作后调用。
   * 同步更新左侧列表的元数据（条目数、状态），避免整列刷新闪烁。
   */
  const handleDetailRefresh = useCallback((updated: AnthologyAdminDetail) => {
    setDetail(updated);
    setAnthologies((prev) =>
      prev.map((a) =>
        a.id === updated.id
          ? {
              ...a,
              status: updated.status,
              entryCount: updated.entries.length,
              hasUnpublishedChanges: updated.hasUnpublishedChanges,
            }
          : a,
      ),
    );
  }, []);

  const handleAddEntry = async (title: string) => {
    if (!selectedId) return;
    const updated = await anthologyApi.addEntry(selectedId, {
      title,
      bodyMarkdown: '',
      changeNote: '添加条目',
    });
    // 找到新增的条目 key（列表末尾），自动跳转编辑器
    const newEntry = updated.entries[updated.entries.length - 1];
    if (newEntry) {
      handleDetailRefresh(updated);
      window.location.href = `/admin/anthology/${selectedId}/entries/${newEntry.key}/edit`;
      return;
    }
    handleDetailRefresh(updated);
  };

  const handleDeleteEntry = async (entryKey: string, entryTitle: string) => {
    if (!selectedId) return;
    const ok = await confirm({
      title: '删除条目',
      message: `确认删除条目「${entryTitle}」？此操作不可撤销。`,
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      /* 若当前正在预览该条目，先返回文集视图 */
      if (selectedEntryKey === entryKey) setSelectedEntry(null);
      const updated = await anthologyApi.removeEntry(selectedId, entryKey);
      handleDetailRefresh(updated);
    } catch {
      banner.error('删除条目失败');
    }
  };

  /* 文集级发布 — 返回 boolean 供 ActionButton 显示 ✓ 反馈 */
  const handlePublish = async (): Promise<boolean> => {
    if (!detail) return false;
    const ok = await confirm({
      title: '发布文集',
      message: `立即发布「${detail.title}」？`,
      confirmLabel: '发布',
    });
    if (!ok) return false;
    try {
      const updated = await anthologyApi.publish(detail.id);
      handleDetailRefresh(updated);
      return true;
    } catch {
      banner.error('发布失败');
      return false;
    }
  };

  const handleUnpublish = async (): Promise<boolean> => {
    if (!detail) return false;
    const ok = await confirm({
      title: '取消发布',
      message: `确认取消发布「${detail.title}」？`,
      danger: true,
      confirmLabel: '取消发布',
    });
    if (!ok) return false;
    try {
      const updated = await anthologyApi.unpublish(detail.id);
      handleDetailRefresh(updated);
      return true;
    } catch {
      banner.error('取消发布失败');
      return false;
    }
  };

  const handlePublishAll = async () => {
    if (!selectedId) return;
    const ok = await confirm({
      title: '批量发布',
      message: '将所有有内容的条目一次性发布，是否继续？',
      confirmLabel: '发布',
    });
    if (!ok) return;
    try {
      const updated = await anthologyApi.publishAllEntries(selectedId);
      handleDetailRefresh(updated);
    } catch {
      banner.error('批量发布失败');
    }
  };

  const handleDeleteAnthology = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: '删除文集',
      message: `确认删除「${detail.title}」？此操作不可撤销，所有条目将一同删除。`,
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await anthologyApi.remove(detail.id);
      setSelectedId(null);
      void loadAnthologies();
    } catch {
      banner.error('删除失败');
    }
  };

  /* 条目级发布 — 返回 boolean 供 ActionButton 显示 ✓ 反馈 */
  const handlePublishEntry = async (): Promise<boolean> => {
    if (!selectedId || !selectedEntryKey) return false;
    const ok = await confirm({
      title: '发布条目',
      message: '发布该条目的最新版本？',
      confirmLabel: '发布',
    });
    if (!ok) return false;
    setEntryPublishing(true);
    try {
      const updated = await anthologyApi.publishEntry(selectedId, selectedEntryKey);
      handleDetailRefresh(updated);
      return true;
    } catch (err) {
      // surface 后端消息(如"请先发布文集,才能发布其中的条目"),让发布顺序可发现
      banner.error(err instanceof Error ? err.message : '发布条目失败');
      return false;
    } finally {
      setEntryPublishing(false);
    }
  };

  const handleUnpublishEntry = async (): Promise<boolean> => {
    if (!selectedId || !selectedEntryKey) return false;
    const ok = await confirm({
      title: '取消发布条目',
      message: '确认取消发布该条目？',
      danger: true,
      confirmLabel: '取消发布',
    });
    if (!ok) return false;
    setEntryPublishing(true);
    try {
      const updated = await anthologyApi.unpublishEntry(selectedId, selectedEntryKey);
      handleDetailRefresh(updated);
      return true;
    } catch {
      banner.error('取消发布条目失败');
      return false;
    } finally {
      setEntryPublishing(false);
    }
  };

  /**
   * 删除当前预览的条目（由 EntryPreviewPanel 标题行 dropdown 触发）。
   * 通过 selectedEntryKey + detail.entries 找到条目标题，复用 handleDeleteEntry。
   */
  const handleDeleteCurrentEntry = async () => {
    if (!selectedEntryKey || !detail) return;
    const meta = detail.entries.find((e) => e.key === selectedEntryKey);
    if (!meta) return;
    await handleDeleteEntry(selectedEntryKey, meta.title);
  };

  /* 文集详情刷新（标题行刷新按钮，重新请求 API） */
  const handleReloadDetail = async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    try {
      const d = await anthologyApi.getById(selectedId);
      handleDetailRefresh(d);
    } catch {
      banner.error('刷新失败');
    } finally {
      setDetailLoading(false);
    }
  };

  /* 当前选中条目的 meta 信息（从 detail.entries 取，保持实时状态） */
  const selectedEntryMeta = selectedEntryKey
    ? (detail?.entries.find((e) => e.key === selectedEntryKey) ?? null)
    : null;

  // ─── 渲染 ───

  /* entryPublishing 仅用于防止并发提交，不在此处展示给子组件（由按钮 flash 反馈代替） */
  void entryPublishing;

  return (
    <>
      {/* ── 左栏：文集列表 ── */}
      <AnthologyList
        anthologies={anthologies}
        loading={listLoading}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
        onReload={() => void loadAnthologies()}
        onCreateSubmit={handleCreate}
      />

      {/* ── 右侧：Topbar + 内容区（中栏 + 右侧面板）── */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
        <Topbar />
        <div className="flex flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {/* 两级视图用 key 切换动画 */}
            {selectedId && selectedEntryKey ? (
              /* 第二级：条目预览 */
              <motion.div
                key={`entry-${selectedEntryKey}`}
                className="flex flex-1 overflow-hidden"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.2, ease: smoothBounce }}
              >
                <EntryPreviewPanel
                  anthologyTitle={detail?.title ?? ''}
                  entry={entryContent}
                  entryMeta={selectedEntryMeta}
                  loading={entryLoading}
                  previewContent={previewContent}
                  previewLoading={previewLoading}
                  onExitPreview={() => { setPreviewVersionId(null); setPreviewContent(null); }}
                  onBack={() => setSelectedEntry(null)}
                  onPublishEntry={handlePublishEntry}
                  onUnpublishEntry={handleUnpublishEntry}
                  onDeleteEntry={handleDeleteCurrentEntry}
                />
                <EntrySidePanel
                  anthologyId={selectedId}
                  entryKey={selectedEntryKey}
                  entryMeta={selectedEntryMeta}
                  draft={entryDraft}
                  draftLoading={entryDraftLoading}
                  history={entryHistory}
                  historyLoading={entryHistoryLoading}
                  activeVersionId={previewVersionId}
                  onSelectVersion={(versionId) => void handleSelectVersion(versionId)}
                />
              </motion.div>
            ) : selectedId ? (
              /* 第一级：条目列表 */
              <motion.div
                key={`anthology-${selectedId}`}
                className="flex flex-1 overflow-hidden"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.2, ease: smoothBounce }}
              >
                {detailLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <LoadingState />
                  </div>
                ) : detail ? (
                  <>
                    <EntryListPanel
                      detail={detail}
                      onEntryClick={(entryKey) => setSelectedEntry(entryKey)}
                      onAddEntry={handleAddEntry}
                      onDeleteEntry={handleDeleteEntry}
                      onReload={() => void handleReloadDetail()}
                      onPublish={handlePublish}
                      onUnpublish={handleUnpublish}
                      onPublishAll={handlePublishAll}
                      onDeleteAnthology={handleDeleteAnthology}
                    />
                    <AnthologySidePanel detail={detail} />
                  </>
                ) : (
                  <EmptyState message="加载文集详情失败，请刷新重试" />
                )}
              </motion.div>
            ) : (
              /* 未选中状态 */
              <motion.div
                key="empty"
                className="flex flex-1 items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <EmptyState message="选择一个文集，或点击新建" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

    </>
  );
}
