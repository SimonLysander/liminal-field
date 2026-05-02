// src/pages/admin/gallery/components/GalleryFeedCard.tsx
//
// 画廊管理布局的两个核心展示组件：
//   - GalleryPostListItem   左侧列表项 (thumbnail + title + badge + date)
//   - GalleryPostPreview    右侧预览区（照片网格 + 详情 + 操作按钮）
//
// GalleryFeedCard（原 Feed 卡片）已被这两个组件取代，此文件保留以便
// 历史引用仍能编译，但推荐从 index.tsx 直接使用上述两者。

import { MapPin } from 'lucide-react';
import type { GalleryPost } from '@/services/workspace';

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

// ─── 状态徽章 ───

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium"
      style={{
        background: status === 'published' ? 'rgba(52,199,89,0.1)' : 'var(--shelf)',
        color: status === 'published' ? 'var(--mark-green)' : 'var(--ink-ghost)',
      }}
    >
      {status === 'published' ? '已发布' : '草稿'}
    </span>
  );
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
  post: GalleryPost;
  isSelected: boolean;
  onClick: () => void;
}

export function GalleryPostListItem({ post, isSelected, onClick }: GalleryPostListItemProps) {
  const thumbnail = post.previewPhotoUrls?.[0] ?? post.coverUrl ?? null;

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
        <div className="flex items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-base"
            style={{ fontWeight: isSelected ? 500 : 400 }}
          >
            {post.title}
          </span>
          <StatusBadge status={post.status} />
        </div>
        <div className="mt-0.5 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
          {formatRelativeTime(post.updatedAt)}
        </div>
      </div>
    </div>
  );
}

// ─── GalleryPostPreview — 右侧预览区 ───
// 完整预览：大标题 + 照片网格 + 描述 + 地点标签 + 状态 + 操作按钮

interface GalleryPostPreviewProps {
  post: GalleryPost & { photos?: Array<{ id: string; url: string; fileName: string; caption: string }> };
  onPhotoClick?: (index: number) => void;
}

export function GalleryPostPreview({
  post,
  onPhotoClick,
}: GalleryPostPreviewProps) {
  const locationTag = post.tags?.location;
  const photoUrls = post.photos?.map((p) => p.url) ?? post.previewPhotoUrls ?? [];

  return (
    <div className="mx-auto max-w-[740px]">
      {/* 标题 */}
      <h1
        className="mb-5 text-2xl font-semibold leading-tight"
        style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
      >
        {post.title}
      </h1>

      {/* 照片网格（可点击查看大图） */}
      {photoUrls.length > 0 && (
        <div className="mb-5">
          <ClickablePhotoGrid urls={photoUrls} onPhotoClick={onPhotoClick} />
        </div>
      )}

      {/* 描述文字 */}
      {post.description && (
        <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--ink-light)' }}>
          {post.description}
        </p>
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

