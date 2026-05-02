// src/pages/admin/gallery/index.tsx
//
// 画廊管理主页面 — 左列表 + 右预览布局
//
// 布局对齐 ContentAdmin / AdminStructurePanel 的模式：
//   左侧 (200px, sidebar-bg)  — 过滤标签 + 帖子列表 + 新建按钮
//   右侧 (flex-1, paper)      — 选中帖子预览（标题/照片/描述/操作）
//
// 与 notes 版本最大的不同：这是扁平一级列表，无文件夹 / 面包屑。

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import Topbar from '@/components/global/Topbar';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { galleryApi, type GalleryPost, type GalleryPostDetail } from '@/services/workspace';
import { smoothBounce } from '@/lib/motion';
import { GalleryPostListItem, GalleryPostPreview } from './components/GalleryFeedCard';
import { PhotoEditModal } from './components/PhotoEditModal';

// ─── 空状态 ───

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
        {message}
      </p>
    </div>
  );
}

// ─── 主组件 ───

export default function GalleryAdmin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [loading, setLoading] = useState(true);

  /* 选中帖子的完整详情（含所有照片） */
  const [detail, setDetail] = useState<GalleryPostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* 照片查看 Modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);

  /* 选中 ID 从 URL 参数 ?post=xxx 读取，保持 URL 同步 */
  const selectedId = searchParams.get('post');

  const setSelectedId = useCallback((id: string | null) => {
    setSearchParams(id ? { post: id } : {}, { replace: true });
  }, [setSearchParams]);

  // ─── 数据加载 ───

  const loadPosts = async () => {
    setLoading(true);
    try {
      const data = await galleryApi.list();
      setPosts(data);
      /* 如果当前选中的帖子在新列表中不存在了，清空 URL 参数 */
      const currentId = searchParams.get('post');
      if (currentId && !data.some((p) => p.id === currentId)) {
        setSelectedId(null);
      }
    } catch {
      toast.error('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPosts();
  }, []);

  /* 选中帖子变化时加载完整详情 */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    galleryApi.getById(selectedId).then((d) => {
      if (!cancelled) { setDetail(d); setDetailLoading(false); }
    }).catch(() => {
      if (!cancelled) { setDetail(null); setDetailLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedId]);

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
      // 删除后清除选中状态，再刷新列表
      if (selectedId === id) setSelectedId(null);
      void loadPosts();
    } catch {
      toast.error('删除失败');
    }
  };

  // ─── 渲染 ───

  return (
    <>
      {/* ── 左侧面板：帖子列表 ── */}
      <aside
        className="flex w-[200px] shrink-0 flex-col overflow-hidden"
        style={{
          background: 'var(--sidebar-bg)',
          borderRight: '0.5px solid var(--separator)',
        }}
      >
        {/* Header：标题 + 数量 */}
        <div className="px-5 pt-5 pb-1">
          <div
            className="text-base font-semibold"
            style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            画廊管理
          </div>
          <div className="mt-1 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
            {posts.length} 条动态
          </div>
        </div>

        {/* 帖子列表 */}
        <div className="mt-3 flex-1 overflow-y-auto px-2.5 pb-4">
          <ContentFade stateKey={loading ? 'loading' : 'list'}>
            {loading ? (
              <LoadingState />
            ) : posts.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
                暂无动态
              </div>
            ) : (
              <div className="mt-1">
                {posts.map((post) => (
                  <GalleryPostListItem
                    key={post.id}
                    post={post}
                    isSelected={selectedId === post.id}
                    onClick={() => setSelectedId(post.id)}
                  />
                ))}
              </div>
            )}
          </ContentFade>
        </div>

        {/* Bottom actions：刷新 + 新建 */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ borderTop: '0.5px solid var(--separator)' }}
        >
          <button
            className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base transition-colors duration-150"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => void loadPosts()}
          >
            <RefreshCw size={9} strokeWidth={1.5} />
            刷新
          </button>
          <button
            className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base font-medium transition-colors duration-150"
            style={{ color: 'var(--ink)' }}
            onClick={() => navigate('/admin/gallery/new')}
          >
            <Plus size={10} strokeWidth={2} />
            新建
          </button>
        </div>
      </aside>

      {/* ── 右侧内容区：预览 ── */}
      <main
        className="relative z-0 flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--paper)' }}
      >
        <Topbar />
        <div className="flex-1 overflow-y-auto px-10 py-9">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedId ?? 'empty'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.2, ease: smoothBounce }}
              className="flex flex-1 flex-col"
            >
              {selectedId && detailLoading ? (
                <LoadingState />
              ) : detail ? (
                <GalleryPostPreview
                  post={detail}
                  onEdit={() => navigate(`/admin/gallery/edit/${detail.id}`)}
                  onPublish={() => void handlePublish(detail.id)}
                  onUnpublish={() => void handleUnpublish(detail.id)}
                  onDelete={() => void handleDelete(detail.id)}
                  onPhotoClick={(index) => { setModalPhotoIndex(index); setModalOpen(true); }}
                />
              ) : (
                <EmptyState message="选择一条动态，或点击新建" />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* 照片查看 Modal（预览模式，只读） */}
      {detail && (
        <PhotoEditModal
          open={modalOpen}
          photos={detail.photos}
          initialIndex={modalPhotoIndex}
          onClose={() => setModalOpen(false)}
          onCaptionChange={() => {}}
          onSetCover={() => {}}
          onDelete={() => {}}
        />
      )}
    </>
  );
}
