// src/pages/admin/gallery/components/GalleryFeedCard.tsx
//
// 画廊 Feed 卡片组件 — 朋友圈风格，展示单条画廊动态。
// 包含：标题 + 状态徽章 + ⋯ 操作菜单、照片预览网格、
// 简介文字（line-clamp-2）、地点 + 时间 + 照片数量的 footer。

import { MoreHorizontal, MapPin } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { GalleryPost } from '@/services/workspace';

// ─── 工具：相对时间（不依赖外部库，满足当前精度需求）───

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

// ─── 照片预览网格 ───
// 1 张：全宽，16/9 比例；2 张：两列，1/1 比例；3+ 张：三列，最多 9 张，1/1 比例

function PhotoPreviewGrid({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;

  const count = urls.length;

  if (count === 1) {
    return (
      <div className="mt-3 overflow-hidden rounded-lg" style={{ aspectRatio: '16/9' }}>
        <img
          src={urls[0]}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  const cols = count === 2 ? 2 : 3;
  const displayUrls = urls.slice(0, 9);

  return (
    <div
      className="mt-3 grid gap-1 overflow-hidden rounded-lg"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {displayUrls.map((url, index) => (
        <div key={index} style={{ aspectRatio: '1' }} className="overflow-hidden">
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

// ─── 状态徽章 ───

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        background: status === 'published' ? 'rgba(52,199,89,0.1)' : 'var(--shelf)',
        color: status === 'published' ? 'var(--mark-green)' : 'var(--ink-ghost)',
      }}
    >
      {status === 'published' ? '已发布' : '草稿'}
    </span>
  );
}

// ─── Props ───

interface GalleryFeedCardProps {
  post: GalleryPost;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}

// ─── 主组件 ───

export function GalleryFeedCard({
  post,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
}: GalleryFeedCardProps) {
  const locationTag = post.tags?.location;

  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{
        background: 'var(--paper)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {/* Header row：标题 + 状态徽章 + ⋯ 菜单 */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-base font-semibold" style={{ color: 'var(--ink)' }}>
          {post.title}
        </span>
        <StatusBadge status={post.status} />

        {/* ⋯ 操作菜单 */}
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
                style={{ color: 'var(--ink-ghost)' }}
                aria-label="更多操作"
              >
                <MoreHorizontal size={16} strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[7rem]">
              {/* 编辑 */}
              <DropdownMenuItem onSelect={onEdit}>编辑</DropdownMenuItem>

              {/* 发布 / 取消发布 */}
              {post.status === 'draft' ? (
                <DropdownMenuItem onSelect={onPublish}>发布</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onUnpublish}>取消发布</DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {/* 删除——AlertDialogTrigger 包裹，点击后弹出确认对话框 */}
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-red-500 focus:text-red-500"
                  onSelect={(e) => {
                    // 阻止 DropdownMenu 在 AlertDialog 触发后关闭，让 AlertDialog 自己管理焦点
                    e.preventDefault();
                  }}
                >
                  删除
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 删除确认对话框 */}
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除？</AlertDialogTitle>
              <AlertDialogDescription>
                删除后无法恢复。将同时删除该动态下的所有照片。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500 hover:bg-red-600"
                onClick={onDelete}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 照片预览网格 */}
      <PhotoPreviewGrid urls={post.previewPhotoUrls} />

      {/* 简介文字（最多两行） */}
      {post.description && (
        <p
          className="mt-3 line-clamp-2 text-sm"
          style={{ color: 'var(--ink-light)' }}
        >
          {post.description}
        </p>
      )}

      {/* Footer：地点 + 相对时间 + 照片数 */}
      <div className="mt-3 flex items-center gap-2">
        {/* 地点标签 */}
        {locationTag && (
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          >
            <MapPin size={11} strokeWidth={1.5} />
            {locationTag}
          </span>
        )}

        {/* 时间 */}
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {formatRelativeTime(post.updatedAt)}
        </span>

        {/* 照片数量 */}
        <span className="ml-auto text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {post.photoCount} 张
        </span>
      </div>
    </div>
  );
}
