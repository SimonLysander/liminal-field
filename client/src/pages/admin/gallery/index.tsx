// src/pages/admin/gallery/index.tsx
//
// 画廊管理主页面（Feed 布局）— 替换原三栏布局。
// 朋友圈风格：顶部 filter tabs + "新建动态"按钮，主体为单列 Feed 卡片列表。
// 最大宽度 600px 居中，背景色使用 var(--shelf) 提供与卡片的对比层次。

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import Topbar from '@/components/global/Topbar';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { galleryApi, type GalleryPost } from '@/services/workspace';
import { GalleryFeedCard } from './components/GalleryFeedCard';

type StatusFilter = 'all' | 'draft' | 'published';

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
];

export default function GalleryAdmin() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // 加载帖子列表，status 参数传 undefined 时后端返回全部
  const loadPosts = async (filter: StatusFilter = statusFilter) => {
    setLoading(true);
    try {
      const data = await galleryApi.list(filter === 'all' ? undefined : filter);
      setPosts(data);
    } catch {
      toast.error('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // filter 变化时重新加载
  useEffect(() => {
    void loadPosts(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // ─── 操作处理 ───

  const handlePublish = async (id: string) => {
    try {
      await galleryApi.publish(id);
      toast.success('已发布');
      void loadPosts();
    } catch {
      toast.error('发布失败');
    }
  };

  const handleUnpublish = async (id: string) => {
    try {
      await galleryApi.unpublish(id);
      toast.success('已取消发布');
      void loadPosts();
    } catch {
      toast.error('取消发布失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await galleryApi.remove(id);
      toast.success('已删除');
      void loadPosts();
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Topbar />

      {/* 内容区：背景 var(--shelf)，提供与白色卡片的层次对比 */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--shelf)' }}>
        <div className="mx-auto w-full max-w-[600px] px-4 py-5">

          {/* 顶部操作栏：filter tabs + 新建按钮 */}
          <div className="mb-5 flex items-center justify-between">
            {/* Filter tabs */}
            <div className="flex gap-1">
              {FILTER_TABS.map((tab) => {
                const isActive = statusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150"
                    style={{
                      background: isActive ? 'var(--ink)' : 'transparent',
                      color: isActive ? 'var(--paper)' : 'var(--ink-ghost)',
                    }}
                    onClick={() => setStatusFilter(tab.key)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* 新建动态按钮 */}
            <button
              className="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors duration-150"
              style={{ background: 'var(--ink)', color: 'var(--paper)' }}
              onClick={() => navigate('/admin/gallery/new')}
            >
              新建动态
            </button>
          </div>

          {/* Feed 列表 */}
          <ContentFade stateKey={loading ? 'loading' : `list-${statusFilter}`}>
            {loading ? (
              <LoadingState />
            ) : posts.length === 0 ? (
              <div
                className="py-16 text-center text-sm"
                style={{ color: 'var(--ink-ghost)' }}
              >
                暂无动态
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {posts.map((post) => (
                  <GalleryFeedCard
                    key={post.id}
                    post={post}
                    onEdit={() => navigate(`/admin/gallery/edit/${post.id}`)}
                    onPublish={() => void handlePublish(post.id)}
                    onUnpublish={() => void handleUnpublish(post.id)}
                    onDelete={() => void handleDelete(post.id)}
                  />
                ))}
              </div>
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}
