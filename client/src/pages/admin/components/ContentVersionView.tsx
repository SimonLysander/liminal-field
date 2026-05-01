/*
 * ContentVersionView — Read-only content preview with version comparison
 *
 * Markdown body container uses rounded-[10px] (radius-lg tier).
 * Preview bar uses mark-blue with 8% opacity background.
 * All font sizes use type scale variables (--text-2xs through --text-4xl).
 * TextLink buttons: pure text style (no border/background), hover changes
 * color from ink-faded to ink for a minimal, Apple-inspired interaction.
 */

import type { ContentStatus } from '@/services/workspace';
import MarkdownBody from '@/components/shared/MarkdownBody';
import type { ContentVersionViewProps } from '../types';
import { LoadingState, ContentFade } from '@/components/LoadingState';

const statusLabel: Record<string, string> = {
  published: '已发布',
  committed: '已提交',
  draft: '草稿',
};

const StatusPill = ({ status }: { status: ContentStatus }) => {
  const isPublished = status === 'published';
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
      {statusLabel[status] ?? status}
    </span>
  );
};

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
  const handlePublish = async () => {
    const confirmed = window.confirm(
      content.status === 'published' && content.hasUnpublishedChanges
        ? '立即发布最新的已提交版本？'
        : '立即发布此已提交版本？',
    );
    if (!confirmed) return;
    await onPublish();
  };

  const handleUnpublish = async () => {
    const confirmed = window.confirm('立即取消发布此文档？');
    if (!confirmed) return;
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

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="font-bold"
            style={{ color: 'var(--ink)', fontSize: 'var(--text-5xl)', fontFamily: 'var(--font-serif)', letterSpacing: '-0.025em' }}
          >
            {node.name}
          </h2>
          {!preview && (
            <>
              <div className="mt-2 flex items-center gap-2.5">
                <StatusPill status={content.status} />
                <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
                  只读
                </span>
              </div>
              {content.status === 'published' && content.hasUnpublishedChanges && (
                <p className="mt-2" style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>
                  存在更新的已提交版本。公开页面仍在使用 {content.publishedVersion?.commitHash.slice(0, 8) ?? '--'}。
                </p>
              )}
            </>
          )}
        </div>
        {!preview && (
          <div className="flex items-center gap-4 pt-1">
            <TextLink label="刷新" onClick={() => void onReload()} />
            {content.status === 'published' ? (
              <>
                {content.hasUnpublishedChanges && (
                  <TextLink label="发布最新" onClick={() => void handlePublish()} />
                )}
                <TextLink label="取消发布" danger onClick={() => void handleUnpublish()} />
              </>
            ) : (
              <TextLink label="发布" onClick={() => void handlePublish()} />
            )}
          </div>
        )}
      </div>

      {/* Preview bar */}
      {preview && (
        <div
          className="flex items-center justify-between rounded-lg px-4 py-2.5"
          style={{ background: 'rgba(10,132,255,0.08)', border: '1px solid rgba(10,132,255,0.15)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ background: 'var(--mark-blue)' }}
            />
            <span className="font-medium" style={{ color: 'var(--mark-blue)', fontSize: 'var(--text-xs)' }}>
              预览版本
            </span>
            <span
              style={{ color: 'var(--mark-blue)', opacity: 0.7, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' }}
            >
              {preview.commitHash.slice(0, 8)}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <TextLink label="发布此版本" onClick={() => void onPublishPreview()} />
            <TextLink label="返回最新" onClick={onExitPreview} />
          </div>
        </div>
      )}

      {previewLoading && (
        <LoadingState label="加载版本内容中" />
      )}

      {/* Markdown body */}
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ border: '1px solid var(--box-border)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background: preview ? 'rgba(10,132,255,0.04)' : 'var(--shelf)',
            borderBottom: '1px solid var(--box-border)',
          }}
        >
          <span
            className="font-semibold uppercase"
            style={{ color: preview ? 'var(--mark-blue)' : 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.04em' }}
          >
            {preview ? '历史版本正文' : '正文'}
          </span>
          <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
            {preview
              ? new Date(preview.committedAt).toLocaleString('zh-CN')
              : new Date(content.updatedAt).toLocaleString('zh-CN')}
          </span>
        </div>
        <div
          className="p-5 leading-[1.9]"
          style={{ fontSize: 'var(--text-lg)' }}
        >
          <MarkdownBody markdown={(preview ? preview.bodyMarkdown : content.bodyMarkdown) || ''} contentItemId={node.contentItemId} />
        </div>
      </div>
    </div>
      )}
    </ContentFade>
  );
};

/* ---------- Primitives ---------- */

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
