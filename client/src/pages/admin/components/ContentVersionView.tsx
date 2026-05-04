/*
 * ContentVersionView — 只读内容预览 + 版本操作
 *
 * 核心逻辑：中间区域始终展示某个版本（最新版或时间线选中的历史版本），
 * 操作按钮跟着"当前展示的版本"走，不再分 preview/非 preview 两套 UI。
 *
 * 版本状态：
 *   - 当前版本 = 已发布版 → 显示"已发布"状态 + "取消发布"操作
 *   - 当前版本 ≠ 已发布版 → 显示"已提交"状态 + "发布此版本"操作
 *   - 正在查看历史版本 → 额外显示"返回最新"
 */

import { useConfirm } from '@/contexts/ConfirmContext';
import MarkdownBody from '@/components/shared/MarkdownBody';
import type { ContentVersionViewProps } from '../types';
import { LoadingState, ContentFade } from '@/components/LoadingState';

export const ContentVersionView = ({
  node,
  content,
  loading,
  error,
  preview,
  previewLoading,
  onReload,
  onPublish,
  onUnpublish,
  onExitPreview,
  onPublishPreview,
}: ContentVersionViewProps) => {
  const confirm = useConfirm();

  /* 当前展示的版本是否为已发布版 */
  const viewingHash = preview?.commitHash ?? content.latestVersion.commitHash;
  const isViewingPublished = viewingHash === content.publishedVersion?.commitHash;
  const isViewingLatest = !preview;

  const handlePublish = async () => {
    if (preview) {
      // 发布历史版本
      const ok = await confirm({
        title: '发布版本',
        message: `发布版本 ${preview.commitHash.slice(0, 8)} ？`,
        confirmLabel: '发布',
      });
      if (!ok) return;
      await onPublishPreview();
    } else {
      // 发布最新版
      const ok = await confirm({
        title: '发布',
        message: '立即发布最新的已提交版本？',
        confirmLabel: '发布',
      });
      if (!ok) return;
      await onPublish();
    }
  };

  const handleUnpublish = async () => {
    const ok = await confirm({
      title: '取消发布',
      message: '立即取消发布此文档？',
      danger: true,
      confirmLabel: '取消发布',
    });
    if (!ok) return;
    await onUnpublish();
  };

  const stateKey = loading ? 'loading' : error ? 'error' : 'content';

  return (
    <ContentFade stateKey={stateKey}>
      {loading ? (
        <LoadingState label="加载内容中" />
      ) : error ? (
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,59,48,0.06)' }}>
          <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-sm)' }}>{error}</p>
        </div>
      ) : (
    <div className="space-y-6">
      {/* Breadcrumb */}
      {node.parentId && (
        <div className="flex items-center gap-1.5" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
          <span style={{ opacity: 0.6 }}>...</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span style={{ color: 'var(--ink-faded)' }}>{node.name}</span>
        </div>
      )}

      {/* Header — 始终显示，不因 preview 隐藏 */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="font-bold"
            style={{ color: 'var(--ink)', fontSize: 'var(--text-5xl)', fontFamily: 'var(--font-serif)', letterSpacing: '-0.025em' }}
          >
            {node.name}
          </h2>
          <div className="mt-2 flex items-center gap-2.5">
            <VersionStatusPill
              isPublished={isViewingPublished}
              commitHash={viewingHash}
            />
            {!preview && (
              <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
                {new Date(content.updatedAt).toLocaleString('zh-CN')}
              </span>
            )}
            {preview && (
              <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
                {new Date(preview.committedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
          {/* 最新版有未发布变更时的提醒（仅在查看最新版时显示） */}
          {isViewingLatest && content.status === 'published' && content.hasUnpublishedChanges && (
            <p className="mt-2" style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>
              公开页面仍在使用旧版本 {content.publishedVersion?.commitHash?.slice(0, 8) ?? '--'}，点击「发布」更新。
            </p>
          )}
        </div>

        {/* 操作按钮 — 跟着当前展示的版本走 */}
        <div className="flex items-center gap-4 pt-1">
          {isViewingLatest && (
            <TextLink label="刷新" onClick={() => void onReload()} />
          )}
          {!isViewingLatest && (
            <TextLink label="返回最新" onClick={onExitPreview} />
          )}
          {isViewingPublished ? (
            <TextLink label="取消发布" danger onClick={() => void handleUnpublish()} />
          ) : (
            <TextLink label="发布" onClick={() => void handlePublish()} />
          )}
        </div>
      </div>

      {previewLoading && (
        <LoadingState label="加载版本内容中" />
      )}

      {/* Markdown body */}
      <div
        className="leading-[1.9]"
        style={{ fontSize: 'var(--text-lg)' }}
      >
        <MarkdownBody
          markdown={(preview ? preview.bodyMarkdown : content.bodyMarkdown) || ''}
          contentItemId={node.contentItemId}
        />
      </div>
    </div>
      )}
    </ContentFade>
  );
};

/* ---------- Primitives ---------- */

/** 版本状态标签：已发布（绿）或已提交（灰）+ commitHash */
function VersionStatusPill({ isPublished, commitHash }: { isPublished: boolean; commitHash: string }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] font-medium"
      style={{
        fontSize: 'var(--text-2xs)',
        background: isPublished ? 'rgba(52,199,89,0.1)' : 'var(--accent-soft)',
        color: isPublished ? 'var(--mark-green)' : 'var(--ink-faded)',
      }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: 'currentColor' }}
      />
      {isPublished ? '已发布' : '已提交'}
      <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
        {commitHash.slice(0, 8)}
      </span>
    </span>
  );
}

function TextLink({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className="transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : 'var(--ink-faded)',
        fontSize: 'var(--text-xs)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onMouseEnter={(e) => {
        if (!danger) e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = danger ? 'var(--mark-red)' : 'var(--ink-faded)';
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
