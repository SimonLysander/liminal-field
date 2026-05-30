/*
 * ContentAdmin — 笔记内容管理模块
 *
 * 布局：AdminStructurePanel（面包屑钻入列表）+ 中间内容预览 + 右侧上下文面板。
 * AdminShell 提供外层容器（h-screen + IconRail），本组件只负责内容区域。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
// 编辑页跳转统一用 window.location.href（Plate inputRules 在 SPA 导航后不生效）
import { smoothBounce } from '@/lib/motion';
import Topbar from '@/components/global/Topbar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentVersionView } from '../components/ContentVersionView';
import { NodeFormModal } from '../components/NodeFormModal';
import { AdminStructurePanel } from '../components/AdminStructurePanel';
import { MoveToDialog } from '../components/MoveToDialog';
import { useAdminWorkspace } from '../hooks/useAdminWorkspace';
import { structureApi } from '@/services/structure';
import { useConfirm } from '@/contexts/ConfirmContext';
import { banner } from '@/components/ui/banner-api';
import type { DraftPresence } from '../types';
import type { ContentHistoryEntry } from '@/services/workspace';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { VersionTimeline } from '../components/VersionTimeline';

const ContentAdmin = () => {
  const workspace = useAdminWorkspace();
  const confirm = useConfirm();
  /* 选中节点的恢复由 useAdminWorkspace 的 URL 同步处理 */

  /* 节点同质化:右侧统一展示"当前节点"——选中的文档,或进入的文件夹本身;两者都是一篇笔记。 */
  const activeNode = workspace.selectedNode ?? workspace.currentFolderNode;

  /* 发布全部:对有子节点的节点,发布其子树(从 ··· 菜单触发)。 */
  const handlePublishAll = useCallback(async () => {
    if (!activeNode) return;
    const ok = await confirm({
      title: '发布全部',
      message: `将发布「${activeNode.name}」下的全部文档。`,
      confirmLabel: '确认发布',
    });
    if (!ok) return;
    await structureApi.batchPublish(activeNode.id);
    banner.success('已发布');
    workspace.reloadLevel();
    if (activeNode.contentItemId) {
      void workspace.loadFormalContent(activeNode.contentItemId);
    }
  }, [activeNode, confirm, workspace]);

  /* ---- TOC ----
   * 数据：来自 API 返回的 headings（formalContent 或 preview），不再解析 markdown
   * 交互：scroll spy + 点击跳转用 DOM ref（按索引定位，不匹配 ID）
   */
  const previewRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  type TocEntry = { level: number; text: string; index: number };
  const headings = workspace.preview?.headings ?? workspace.formalContent.headings;
  const toc = useMemo<TocEntry[]>(
    () => headings.map((h, i) => ({ level: h.level, text: h.text, index: i })),
    [headings],
  );

  /** 获取预览区内所有 heading DOM 元素 */
  const getHeadingEls = useCallback(
    () => previewRef.current?.querySelectorAll<HTMLElement>('[data-heading-id]'),
    [],
  );

  /* Scroll spy */
  const handlePreviewScroll = useCallback(() => {
    const container = previewRef.current;
    const els = getHeadingEls();
    if (!container || !els || els.length === 0) return;
    const threshold = container.getBoundingClientRect().top + 50;
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].getBoundingClientRect().top <= threshold) {
        setActiveIndex(i);
        return;
      }
    }
    setActiveIndex(0);
  }, [getHeadingEls]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.addEventListener('scroll', handlePreviewScroll, { passive: true });
    return () => el.removeEventListener('scroll', handlePreviewScroll);
  }, [handlePreviewScroll]);

  /* 点击跳转 + 高亮 */
  const scrollToHeading = useCallback((index: number) => {
    const els = getHeadingEls();
    const container = previewRef.current;
    if (!els || !els[index] || !container) return;
    const el = els[index];
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16;
    container.scrollTo({ top, behavior: 'smooth' });

    el.classList.remove('toc-highlight');
    void el.offsetWidth;
    el.classList.add('toc-highlight');
    el.addEventListener('animationend', () => el.classList.remove('toc-highlight'), { once: true });
  }, [getHeadingEls]);

  const editUrl = activeNode?.contentItemId
    ? `/admin/notes/${activeNode.contentItemId}/edit`
    : null;

  return (
    <>
      {/* 面包屑钻入导航面板 */}
      <AdminStructurePanel
        nodes={workspace.nodes}
        loading={workspace.loading}
        error={workspace.error}
        selectedNodeId={workspace.selectedNode?.id ?? null}
        breadcrumb={workspace.breadcrumb}
        currentParentId={workspace.currentParentId}
        onReload={workspace.reloadLevel}
        onEnterFolder={workspace.enterFolder}
        onGoToBreadcrumb={workspace.goToBreadcrumb}
        onAddChild={workspace.openCreate}
        onReorder={workspace.reorderNodes}
      />

      {/* Main content area */}
      <main
        className="relative z-0 flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--paper)' }}
      >
        <Topbar />
        <div className="flex flex-1 overflow-hidden">
          {/* Center — content preview */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className="flex-1 overflow-y-auto px-10 py-9 max-[520px]:px-4"
              ref={previewRef}
            >
              <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeNode?.id ?? 'empty'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.2, ease: smoothBounce }}
                >
                  {activeNode?.contentItemId ? (
                    <ContentVersionView
                      node={activeNode}
                      content={workspace.formalContent}
                      loading={workspace.contentLoading}
                      error={workspace.contentError}
                      preview={workspace.preview}
                      previewLoading={workspace.previewLoading}
                      onSaveSummary={workspace.updateSummary}
                      onReload={() => workspace.loadFormalContent(activeNode.contentItemId!)}
                      onPublish={workspace.publishContent}
                      onUnpublish={workspace.unpublishContent}
                      onExitPreview={workspace.exitPreview}
                      onPublishPreview={workspace.publishPreview}
                      onEdit={workspace.openEdit}
                      onDelete={workspace.setDeleteTarget}
                      onMoveTo={workspace.setMoveTarget}
                      onPublishAll={activeNode.hasChildren ? handlePublishAll : undefined}
                    />
                  ) : (
                    <EmptyState title="未选择节点" subtitle="从左侧选择一个节点开始。" />
                  )}
                </motion.div>
              </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right — contextual side panel */}
          <aside
            className="flex shrink-0 flex-col overflow-hidden px-5 py-7"
            style={{ width: 'var(--layout-context)' }}
          >
            {activeNode?.contentItemId ? (
              <FormalSidePanel
                toc={toc}
                activeIndex={activeIndex}
                onScrollToHeading={scrollToHeading}
                draftPresence={workspace.draftPresence}
                history={workspace.history}
                historyLoading={workspace.historyLoading}
                publishedVersionId={workspace.formalContent.publishedVersion?.versionId ?? null}
                activeVersionId={workspace.preview?.versionId ?? null}
                onEditDraft={() => {
                  if (editUrl) window.location.href = editUrl;
                }}
                onSelectVersion={workspace.previewVersion}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
                  选择文档查看详情
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* Modals */}
      {workspace.modal.open && (
        <NodeFormModal
          modal={workspace.modal}
          onClose={workspace.closeModal}
          onSubmit={workspace.handleCreateOrEdit}
        />
      )}
      {workspace.deleteTarget && (
        <ConfirmDialog
          node={workspace.deleteTarget}
          onConfirm={workspace.handleDelete}
          onCancel={() => workspace.setDeleteTarget(null)}
        />
      )}
      {workspace.moveTarget && (
        <MoveToDialog
          node={workspace.moveTarget}
          scope="notes"
          onConfirm={(targetFolderId) =>
            workspace.moveNodeToFolder(workspace.moveTarget!.id, targetFolderId)
          }
          onClose={() => workspace.setMoveTarget(null)}
        />
      )}
    </>
  );
};

/* ---------- Side panel sections ---------- */

function FormalSidePanel({
  toc,
  activeIndex,
  onScrollToHeading,
  draftPresence,
  history,
  historyLoading,
  publishedVersionId,
  activeVersionId,
  onEditDraft,
  onSelectVersion,
}: {
  toc: Array<{ level: number; text: string; index: number }>;
  activeIndex: number;
  onScrollToHeading: (index: number) => void;
  draftPresence: DraftPresence;
  history: ContentHistoryEntry[];
  historyLoading: boolean;
  publishedVersionId: string | null;
  activeVersionId: string | null;
  onEditDraft: () => void;
  onSelectVersion: (versionId: string) => Promise<void>;
}) {
  const tocPanelRef = useRef<HTMLDivElement>(null);

  /* 大纲面板自动滚动：activeIndex 变化时，将激活项滚入可视区 */
  useEffect(() => {
    const panel = tocPanelRef.current;
    if (activeIndex < 0 || !panel) return;
    const activeEl = panel.children[activeIndex] as HTMLElement | undefined;
    if (!activeEl) return;
    const panelRect = panel.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    const offset = elRect.top - panelRect.top + panel.scrollTop;
    const target = offset - panel.clientHeight / 2 + activeEl.offsetHeight / 2;
    panel.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 大纲 — flex-1，内部滚动；无标题时占位，避免布局跳动 */}
      <div className="mb-5 flex min-h-0 flex-1 flex-col">
        <div
          className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          大纲
        </div>
        <div ref={tocPanelRef} className="min-h-0 flex-1 overflow-y-auto">
          {toc.length > 0 ? (
            toc.map((item, i) => {
              const isActive = activeIndex === i;
              return (
                <motion.div
                  key={item.index}
                  className="cursor-pointer border-l-2 py-[5px] text-sm transition-all duration-200"
                  style={{
                    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
                    fontWeight: isActive ? 500 : 400,
                    borderColor: isActive ? 'var(--ink)' : 'transparent',
                    paddingLeft: `${(item.level - 1) * 8 + 10}px`,
                  }}
                  animate={{ paddingLeft: isActive ? (item.level - 1) * 8 + 12 : (item.level - 1) * 8 + 10 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={() => onScrollToHeading(i)}
                >
                  {item.text}
                </motion.div>
              );
            })
          ) : (
            <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无标题</p>
          )}
        </div>
      </div>

      {/* 编辑 — shrink-0，固定高度 */}
      <div className="mb-5 shrink-0">
        <div
          className="mb-2.5 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          编辑
        </div>
        {draftPresence.exists ? (
          <div className="space-y-2">
            <InfoRow label="已有草稿" value="是" />
            <InfoRow
              label="上次保存"
              value={draftPresence.savedAt ? new Date(draftPresence.savedAt).toLocaleString('zh-CN') : '--'}
            />
            <div className="flex gap-4 pt-2">
              <SideLink label="继续编辑 →" primary onClick={onEditDraft} />
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
              进入编辑器创建草稿
            </p>
            <SideLink label="开始编辑 →" primary onClick={onEditDraft} />
          </>
        )}
      </div>

      {/* 版本 — flex-1，内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          版本
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ContentFade stateKey={historyLoading ? 'loading' : 'history'}>
            {historyLoading ? (
              <LoadingState />
            ) : history.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无版本</p>
            ) : (
              <VersionTimeline
                history={history}
                publishedVersionId={publishedVersionId}
                activeVersionId={activeVersionId}
                onSelect={(versionId) => void onSelectVersion(versionId)}
              />
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}

/* ---------- Shared primitives ---------- */

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="text-base font-medium" style={{ color: 'var(--ink-ghost)' }}>{title}</div>
      <p className="mt-2 text-sm" style={{ color: 'var(--ink-ghost)', opacity: 0.6 }}>{subtitle}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function SideLink({
  label,
  primary,
  danger,
  onClick,
}: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default ContentAdmin;
