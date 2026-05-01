// src/pages/admin/gallery/components/PostList.tsx

import { RefreshCw, Plus } from 'lucide-react';
import type { GalleryPost } from '@/services/workspace';
import { LoadingState, ContentFade } from '@/components/LoadingState';

type StatusFilter = 'all' | 'draft' | 'published';

const FILTER_LABELS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
];

export function PostList({
  posts,
  loading,
  selectedPostId,
  statusFilter,
  onSelect,
  onFilterChange,
  onCreate,
  onReload,
}: {
  posts: GalleryPost[];
  loading: boolean;
  selectedPostId: string | null;
  statusFilter: StatusFilter;
  onSelect: (postId: string) => void;
  onFilterChange: (filter: StatusFilter) => void;
  onCreate: () => void;
  onReload: () => void;
}) {
  return (
    <div
      className="flex w-[200px] shrink-0 flex-col overflow-hidden"
      style={{ background: 'var(--sidebar-bg)', borderRight: '0.5px solid var(--separator)' }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-1">
        <div
          className="font-semibold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-base)', letterSpacing: '-0.01em' }}
        >
          画廊管理
        </div>
        <div className="mt-1" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
          {posts.length} 条动态
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mt-3 flex gap-0 px-4 pb-2">
        {FILTER_LABELS.map((f) => (
          <button
            key={f.key}
            className="rounded-md px-2 py-1 transition-colors duration-150"
            style={{
              fontSize: 'var(--text-2xs)',
              fontWeight: statusFilter === f.key ? 500 : 400,
              background: statusFilter === f.key ? 'var(--shelf)' : 'transparent',
              color: statusFilter === f.key ? 'var(--ink)' : 'var(--ink-ghost)',
            }}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Post list */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        <ContentFade stateKey={loading && posts.length === 0 ? 'loading' : 'list'}>
          {loading && posts.length === 0 ? (
            <LoadingState />
          ) : posts.length === 0 ? (
            <div className="px-3 py-8 text-center" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
              暂无动态
            </div>
          ) : (
            <div>
              {posts.map((post) => {
                const isSelected = selectedPostId === post.id;
                return (
                  <div
                    key={post.id}
                    className="flex cursor-pointer gap-2 rounded-[10px] px-2 py-2 transition-all duration-150"
                    style={{
                      background: isSelected ? 'var(--shelf)' : 'transparent',
                    }}
                    onClick={() => onSelect(post.id)}
                  >
                    {/* Cover thumbnail */}
                    <div
                      className="shrink-0 rounded-md"
                      style={{
                        width: 38,
                        height: 38,
                        background: post.coverUrl
                          ? `url(${post.coverUrl}) center/cover`
                          : 'var(--paper-dark)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate"
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: isSelected ? 'var(--ink)' : 'var(--ink-light)',
                          fontWeight: isSelected ? 500 : 400,
                        }}
                      >
                        {post.title}
                      </div>
                      <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-ghost)', marginTop: 1 }}>
                        {post.photoCount} 张 · {new Date(post.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                      </div>
                      <span
                        className="rounded px-1 font-medium"
                        style={{
                          fontSize: '0.5625rem',
                          background: post.status === 'published' ? 'rgba(52,199,89,0.1)' : 'var(--shelf)',
                          color: post.status === 'published' ? 'var(--mark-green)' : 'var(--ink-ghost)',
                        }}
                      >
                        {post.status === 'published' ? '已发布' : '草稿'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ContentFade>
      </div>

      {/* Bottom actions */}
      <div
        className="flex items-center justify-between px-5 pb-4"
        style={{ borderTop: '0.5px solid var(--separator)', paddingTop: 12 }}
      >
        <button
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-xs)' }}
          onClick={onReload}
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          刷新
        </button>
        <button
          className="flex items-center gap-1 font-medium transition-colors duration-150"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-xs)' }}
          onClick={onCreate}
        >
          <Plus size={12} strokeWidth={2} />
          新建
        </button>
      </div>
    </div>
  );
}
