/*
 * ContentAdmin — 笔记内容管理模块
 *
 * 布局：AdminStructurePanel（面包屑钻入列表）+ 中间内容预览 + 右侧上下文面板。
 * AdminShell 提供外层容器（h-screen + IconRail），本组件只负责内容区域。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { smoothBounce } from '@/lib/motion';
import { notesApi as contentItemsApi } from '@/services/workspace';
import { extractHeadings, type TocEntry } from '@/lib/markdown';
import Topbar from '@/components/global/Topbar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentVersionView } from '../components/ContentVersionView';
import { FolderDetailPanel } from '../components/FolderDetailPanel';
import { NodeFormModal } from '../components/NodeFormModal';
import { AdminStructurePanel } from '../components/AdminStructurePanel';
import { MoveToDialog } from '../components/MoveToDialog';
import { useAdminWorkspace } from '../hooks/useAdminWorkspace';
import type { DraftPresence } from '../types';
import type { ContentHistoryEntry } from '@/services/workspace';
import { LoadingState, ContentFade } from '@/components/LoadingState';

const ContentAdmin = () => {
  const workspace = useAdminWorkspace();
  const navigate = useNavigate();
  /* 选中节点的恢复由 useAdminWorkspace 的 URL 同步处理 */

  /* ---- TOC ----
   * 数据：useMemo 从 bodyMarkdown 纯函数提取（不碰 DOM，无时序问题）
   * 交互：scroll spy + 点击跳转用 DOM ref（按索引定位，不匹配 ID）
   */
  const previewRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const bodyMarkdown = workspace.preview?.bodyMarkdown ?? workspace.formalContent.bodyMarkdown;
  const toc = useMemo(() => extractHeadings(bodyMarkdown), [bodyMarkdown]);

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

  const editUrl = workspace.selectedNode?.contentItemId
    ? `/admin/edit/${workspace.selectedNode.contentItemId}`
    : null;

  const handleOverwriteDraft = async () => {
    if (!workspace.selectedNode?.contentItemId) return;
    const confirmed = window.confirm('是否覆盖已有草稿？将从正式版本重新创建。');
    if (!confirmed) return;
    await contentItemsApi.deleteDraft(workspace.selectedNode.contentItemId);
    navigate(`/admin/edit/${workspace.selectedNode.contentItemId}`);
  };

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
        onSelect={workspace.selectNode}
        onEnterFolder={workspace.enterFolder}
        onGoToBreadcrumb={workspace.goToBreadcrumb}
        onAddChild={workspace.openCreate}
        onEdit={workspace.openEdit}
        onDelete={workspace.setDeleteTarget}
        onMoveTo={workspace.setMoveTarget}
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
            <div className="flex-1 overflow-y-auto px-10 py-9" ref={previewRef}>
              <div className="mx-auto max-w-[740px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={workspace.selectedNode?.id ?? 'empty'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.2, ease: smoothBounce }}
                >
                  {!workspace.selectedNode ? (
                    <EmptyState title="未选择节点" subtitle="从左侧列表中选择一个文件夹或文档开始。" />
                  ) : workspace.selectedNode.type === 'FOLDER' ? (
                    <FolderDetailPanel node={workspace.selectedNode} />
                  ) : workspace.selectedNode.contentItemId ? (
                    <ContentVersionView
                      node={workspace.selectedNode}
                      content={workspace.formalContent}
                      loading={workspace.contentLoading}
                      error={workspace.contentError}
                      preview={workspace.preview}
                      previewLoading={workspace.previewLoading}
                      onReload={() => workspace.loadFormalContent(workspace.selectedNode!.contentItemId!)}
                      onPublish={workspace.publishContent}
                      onUnpublish={workspace.unpublishContent}
                      onExitPreview={workspace.exitPreview}
                      onPublishPreview={workspace.publishPreview}
                    />
                  ) : (
                    <EmptyState title="DOC 绑定异常" subtitle="该 DOC 节点没有关联的内容项，请重新创建。" />
                  )}
                </motion.div>
              </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right — contextual side panel */}
          <aside
            className="flex w-[280px] shrink-0 flex-col overflow-hidden px-5 py-7"
            style={{ borderLeft: '0.5px solid var(--separator)' }}
          >
            {workspace.selectedNode?.contentItemId ? (
              <FormalSidePanel
                toc={toc}
                activeIndex={activeIndex}
                onScrollToHeading={scrollToHeading}
                draftPresence={workspace.draftPresence}
                history={workspace.history}
                historyLoading={workspace.historyLoading}
                publishedHash={workspace.formalContent.publishedVersion?.commitHash ?? null}
                activePreviewHash={workspace.preview?.commitHash ?? null}
                onEditDraft={() => editUrl && navigate(editUrl)}
                onOverwriteDraft={handleOverwriteDraft}
                onSelectVersion={workspace.previewVersion}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}>
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
  publishedHash,
  activePreviewHash,
  onEditDraft,
  onOverwriteDraft,
  onSelectVersion,
}: {
  toc: TocEntry[];
  activeIndex: number;
  onScrollToHeading: (index: number) => void;
  draftPresence: DraftPresence;
  history: ContentHistoryEntry[];
  historyLoading: boolean;
  publishedHash: string | null;
  activePreviewHash: string | null;
  onEditDraft: () => void;
  onOverwriteDraft: () => Promise<void>;
  onSelectVersion: (commitHash: string) => Promise<void>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 大纲 — flex-1，内部滚动 */}
      {toc.length > 0 && (
        <div className="mb-5 flex min-h-0 flex-1 flex-col">
          <div
            className="mb-2.5 shrink-0 font-semibold uppercase"
            style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.06em' }}
          >
            大纲
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {toc.map((item, i) => {
              const isActive = activeIndex === i;
              return (
                <motion.div
                  key={item.index}
                  className="cursor-pointer border-l-2 py-[5px] transition-all duration-200"
                  style={{
                    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
                    fontWeight: isActive ? 500 : 400,
                    fontSize: 'var(--text-sm)',
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
            })}
          </div>
        </div>
      )}

      {/* 编辑 — shrink-0，固定高度 */}
      <div className="mb-5 shrink-0">
        <div
          className="mb-2.5 font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.06em' }}
        >
          编辑
        </div>
        <div
          className="rounded-[10px] p-4"
          style={{ border: '1px solid var(--box-border)', background: 'var(--shelf)' }}
        >
          {draftPresence.exists ? (
            <div className="space-y-2">
              <InfoRow label="已有草稿" value="是" />
              <InfoRow
                label="上次保存"
                value={draftPresence.savedAt ? new Date(draftPresence.savedAt).toLocaleString('zh-CN') : '--'}
              />
              <div className="flex gap-4 pt-2">
                <SideLink label="继续编辑 →" primary onClick={onEditDraft} />
                <SideLink label="覆盖重建" danger onClick={() => void onOverwriteDraft()} />
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3.5 leading-relaxed" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
                进入编辑器创建草稿
              </p>
              <SideLink label="开始编辑 →" primary onClick={onEditDraft} />
            </>
          )}
        </div>
      </div>

      {/* 版本 — flex-1，内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="mb-2.5 shrink-0 font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.06em' }}
        >
          版本
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ContentFade stateKey={historyLoading ? 'loading' : 'history'}>
            {historyLoading ? (
              <LoadingState />
            ) : history.length === 0 ? (
              <p style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>暂无版本</p>
            ) : (
              <VersionTimeline
                history={history}
                publishedHash={publishedHash}
                activePreviewHash={activePreviewHash}
                onSelect={(hash) => void onSelectVersion(hash)}
              />
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}

/** 跨天显示 "M/D HH:mm"，当天只显示 "HH:mm" */
function formatCommitTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function VersionTimeline({
  history,
  publishedHash,
  activePreviewHash,
  onSelect,
}: {
  history: ContentHistoryEntry[];
  publishedHash: string | null;
  activePreviewHash?: string | null;
  onSelect?: (commitHash: string) => void;
}) {
  return (
    <div className="relative" style={{ paddingLeft: 16 }}>
      {/* Vertical line — 居中对齐圆点（圆点 center = left -12 + 16 + 3.5 = 7.5） */}
      <div
        className="absolute"
        style={{
          left: 7,
          top: 8,
          bottom: 8,
          width: 1,
          background: 'var(--box-border)',
        }}
      />
      {history.map((entry, i) => {
        const isPublished = publishedHash === entry.commitHash;
        const isFirst = i === 0;
        /* 没有预览旧版本时，默认高亮最新版本 */
        const isActive = activePreviewHash
          ? activePreviewHash === entry.commitHash
          : isFirst;
        const title = entry.message.split(' | ')[1]?.trim()
          || (entry.action === 'commit' ? '正式版本提交' : '版本更新');

        return (
          <div
            key={entry.commitHash}
            className="relative cursor-pointer transition-all duration-150 hover:opacity-80"
            style={{
              padding: '8px 0 8px 12px',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              borderRadius: isActive ? 'var(--radius-sm)' : 0,
            }}
            onClick={() => onSelect?.(entry.commitHash)}
          >
            {/* Node dot */}
            <span
              className="absolute rounded-full"
              style={{
                left: -12,
                top: 12,
                width: 7,
                height: 7,
                background: isActive
                  ? 'var(--mark-blue)'
                  : isPublished
                    ? 'var(--mark-green)'
                    : isFirst
                      ? 'var(--ink)'
                      : 'var(--ink-ghost)',
                border: '1.5px solid var(--paper-dark)',
                boxShadow: isActive
                  ? '0 0 6px rgba(10,132,255,0.4)'
                  : isPublished
                    ? '0 0 6px rgba(48,209,88,0.3)'
                    : 'none',
              }}
            />
            <div
              className="font-medium"
              style={{ color: isFirst ? 'var(--ink)' : 'var(--ink-light)', fontSize: 'var(--text-xs)', marginBottom: 3 }}
            >
              {title}
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {entry.commitHash.slice(0, 8)}
              </span>
              <span>· {formatCommitTime(entry.committedAt)}</span>
              {isPublished && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{ background: 'rgba(48,209,88,0.12)', color: 'var(--mark-green)', fontSize: '0.5625rem' }}
                >
                  已发布
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Shared primitives ---------- */

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="font-medium" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>{title}</div>
      <p className="mt-2" style={{ color: 'var(--ink-ghost)', opacity: 0.6, fontSize: 'var(--text-sm)' }}>{subtitle}</p>
    </div>
  );
}

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div
        className="mb-3.5 font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.06em' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-xs)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--ink)', fontSize: 'var(--text-xs)' }}>{value}</span>
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
      className="transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
        fontSize: 'var(--text-xs)',
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
