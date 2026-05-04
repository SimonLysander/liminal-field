// src/pages/admin/gallery/components/GalleryFeedCard.tsx
//
// 画廊管理布局的两个核心展示组件：
//   - GalleryPostListItem   左侧列表项 (thumbnail + title + badge + date)
//   - GalleryPostPreview    右侧预览区（照片网格 + 详情 + 操作按钮）
//
// GalleryFeedCard（原 Feed 卡片）已被这两个组件取代，此文件保留以便
// 历史引用仍能编译，但推荐从 index.tsx 直接使用上述两者。

import { MapPin } from 'lucide-react';
import type { GalleryAdminListItem, GalleryAdminDetail } from '@/services/workspace';
import MarkdownBody from '@/components/shared/MarkdownBody';

// ─── 工具：相对时间（不依赖外部库）───

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}


// ─── 可点击照片网格（5 列，与编辑页 PhotoGrid 一致）───

function ClickablePhotoGrid({ urls, onPhotoClick }: { urls: string[]; onPhotoClick?: (index: number) => void }) {
  if (urls.length === 0) return null;

  return (
    <div className="grid grid-cols-5 gap-1.5">
      {urls.map((url, index) => (
        <div
          key={index}
          className="aspect-square cursor-pointer overflow-hidden rounded-md transition-opacity hover:opacity-80"
          onClick={() => onPhotoClick?.(index)}
        >
          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
        </div>
      ))}
    </div>
  );
}

// ─── GalleryPostListItem — 左侧列表项 ───
// 缩略图 (38×38) + 标题 + 状态徽章 + 更新日期，点击选中

interface GalleryPostListItemProps {
  post: GalleryAdminListItem;
  isSelected: boolean;
  onClick: () => void;
}

export function GalleryPostListItem({ post, isSelected, onClick }: GalleryPostListItemProps) {
  const thumbnail = post.coverUrl ?? null;

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150"
      style={{
        background: isSelected ? 'var(--shelf)' : undefined,
        color: isSelected ? 'var(--ink)' : 'var(--ink-light)',
      }}
      onClick={onClick}
    >
      {/* 缩略图 */}
      <div
        className="shrink-0 overflow-hidden rounded"
        style={{ width: 38, height: 38, background: 'var(--separator)' }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span style={{ color: 'var(--ink-ghost)', fontSize: 16 }}>📷</span>
          </div>
        )}
      </div>

      {/* 文字内容：标题 + 徽章 + 日期 */}
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-base"
          style={{ fontWeight: isSelected ? 500 : 400 }}
        >
          {post.title}
        </div>
        <div className="mt-0.5 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
          {formatRelativeTime(post.updatedAt)}
        </div>
      </div>
    </div>
  );
}

// ─── GalleryPostPreview — 右侧预览区 ───
// 统一模型：始终展示某个版本，操作按钮跟着当前展示的版本走。
// isViewingHistory=true 时显示"返回最新"，isViewingPublished 决定发布/取消发布按钮。

interface GalleryPostPreviewProps {
  post: GalleryAdminDetail & {
    photos?: Array<{ id: string; url: string; fileName: string; caption: string; tags: Record<string, string> }>;
    photoCount?: number;
    prose?: string;
  };
  /** 是否正在查看历史版本 */
  isViewingHistory?: boolean;
  /** 当前展示的版本是否为已发布版 */
  isViewingPublished?: boolean;
  /** 当前展示的版本 commitHash */
  viewingHash?: string;
  onExitPreview?: () => void;
  onPhotoClick?: (index: number) => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onDelete?: () => void;
}

export function GalleryPostPreview({
  post,
  isViewingHistory,
  isViewingPublished,
  viewingHash,
  onExitPreview,
  onPhotoClick,
  onPublish,
  onUnpublish,
  onDelete,
}: GalleryPostPreviewProps) {
  const locationTag = post.location;
  const photoUrls = (post.photos ?? []).map((p) => p.url);
  const prose = post.prose;

  return (
    <div className="mx-auto w-full max-w-[740px]">
      {/* 标题 + 版本状态 + 操作按钮 */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1
            className="text-2xl font-semibold leading-tight"
            style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
          >
            {post.title}
          </h1>
          {/* 版本状态标签 */}
          <div className="mt-2 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] font-medium"
              style={{
                fontSize: 'var(--text-2xs)',
                background: isViewingPublished ? 'rgba(52,199,89,0.1)' : 'var(--accent-soft)',
                color: isViewingPublished ? 'var(--mark-green)' : 'var(--ink-faded)',
              }}
            >
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'currentColor' }} />
              {isViewingPublished ? '已发布' : '已提交'}
              {viewingHash && (
                <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                  {viewingHash.slice(0, 8)}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* 操作按钮 — TextLink 风格，跟 notes 管理端一致 */}
        <div className="flex shrink-0 items-center gap-4 pt-1">
          {isViewingHistory && onExitPreview && (
            <TextLink label="返回最新" onClick={onExitPreview} />
          )}
          {isViewingPublished
            ? onUnpublish && <TextLink label="取消发布" danger onClick={onUnpublish} />
            : onPublish && <TextLink label="发布" onClick={onPublish} />
          }
          {onDelete && <TextLink label="删除" danger onClick={onDelete} />}
        </div>
      </div>

      {/* 照片网格（可点击查看大图） */}
      {photoUrls.length > 0 && (
        <div className="mb-5">
          <ClickablePhotoGrid urls={photoUrls} onPhotoClick={onPhotoClick} />
        </div>
      )}

      {/* 随笔（markdown 渲染） */}
      {prose && (
        <div className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--ink-light)' }}>
          <MarkdownBody markdown={prose} />
        </div>
      )}

      {/* 地点标签 */}
      {locationTag && (
        <div className="mb-4">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          >
            <MapPin size={11} strokeWidth={1.5} />
            {locationTag}
          </span>
        </div>
      )}
    </div>
  );
}

/* TextLink — 与 notes ContentVersionView 中的 TextLink 一致 */
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

