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
import { galleryApi, type GalleryPost, type GalleryPostDetail, type ContentHistoryEntry } from '@/services/workspace';
import { smoothBounce } from '@/lib/motion';
import { GalleryPostListItem, GalleryPostPreview } from './components/GalleryFeedCard';
import { PhotoLightbox } from './components/PhotoLightbox';

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

  /* 草稿状态 */
  const [draftInfo, setDraftInfo] = useState<{ exists: boolean; savedAt?: string }>({ exists: false });

  /* 版本历史 */
  const [history, setHistory] = useState<ContentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* 版本预览：点击历史版本时加载该版本的内容 */
  const [preview, setPreview] = useState<{ commitHash: string; title: string; description: string; committedAt: string } | null>(null);

  /* 选中帖子变化时并行加载：详情 + 草稿 + 版本历史 */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDraftInfo({ exists: false });
      setHistory([]);
      setPreview(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setHistoryLoading(true);

    Promise.all([
      galleryApi.getById(selectedId),
      galleryApi.getDraft(selectedId).catch(() => null),
      galleryApi.getHistory(selectedId).catch(() => []),
    ]).then(([d, draft, hist]) => {
      if (cancelled) return;
      setDetail(d);
      setDraftInfo(draft ? { exists: true, savedAt: draft.savedAt } : { exists: false });
      setHistory(hist);
      setDetailLoading(false);
      setHistoryLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setDetail(null);
        setDraftInfo({ exists: false });
        setHistory([]);
        setDetailLoading(false);
        setHistoryLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [selectedId]);

  // ─── 操作处理 ───

  /** 切换版本预览：点击历史版本节点 */
  const handlePreviewVersion = async (commitHash: string) => {
    if (!selectedId) return;
    /* 如果点的是最新版本，退出预览模式 */
    if (history[0]?.commitHash === commitHash) {
      setPreview(null);
      return;
    }
    try {
      const versionContent = await galleryApi.getByVersion(selectedId, commitHash);
      setPreview({
        commitHash,
        title: versionContent.title,
        description: versionContent.bodyMarkdown === '\u200B' ? '' : versionContent.bodyMarkdown,
        committedAt: versionContent.updatedAt,
      });
    } catch {
      toast.error('加载版本失败');
    }
  };

  /** 丢弃草稿：删除草稿 → 刷新 */
  const handleDiscardDraft = async (id: string) => {
    try {
      await galleryApi.deleteDraft(id);
      toast.success('草稿已丢弃');
      setDraftInfo({ exists: false });
    } catch {
      toast.error('丢弃失败');
    }
  };

  /** 刷新选中帖子的详情 + 历史（发布/取消发布/提交后调用） */
  const reloadDetail = async (id: string) => {
    const [d, hist] = await Promise.all([
      galleryApi.getById(id),
      galleryApi.getHistory(id).catch(() => []),
    ]);
    setDetail(d);
    setHistory(hist);
  };

  /** 发布指定历史版本：一步完成（action: 'publish'），跟 note 的 publishPreview 一致 */
  const handlePublishVersion = async (id: string, commitHash: string) => {
    try {
      const versionContent = await galleryApi.getByVersion(id, commitHash);
      await galleryApi.update(id, {
        title: versionContent.title,
        description: versionContent.bodyMarkdown === '\u200B' ? '' : versionContent.bodyMarkdown,
        action: 'publish',
      });
      toast.success(`版本 ${commitHash.slice(0, 8)} 已发布`);
      setPreview(null);
      void loadPosts();
      void reloadDetail(id);
    } catch {
      toast.error('发布失败');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      /* 读取最新内容，以 action: 'publish' 一步完成发布 */
      const latest = await galleryApi.getById(id);
      await galleryApi.update(id, {
        title: latest.title,
        description: latest.description,
        action: 'publish',
      });
      toast.success('已发布');
      void loadPosts();
      void reloadDetail(id);
    } catch {
      toast.error('发布失败');
    }
  };

  const handleUnpublish = async (id: string) => {
    try {
      await galleryApi.unpublish(id);
      toast.success('已取消发布');
      void loadPosts();
      void reloadDetail(id);
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

      {/* ── 右侧：Topbar + 内容预览 + 信息侧栏 ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <div className="flex flex-1 overflow-hidden">
          {/* 中间：内容预览 */}
          <main
            className="relative z-0 flex-1 overflow-y-auto px-10 py-9"
            style={{ background: 'var(--paper)' }}
          >
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
                  <>
                    {/* 版本预览横幅 */}
                    {preview && (
                      <div
                        className="mb-4 flex items-center justify-between rounded-lg px-4 py-2.5"
                        style={{ background: 'rgba(10,132,255,0.08)', border: '1px solid rgba(10,132,255,0.2)' }}
                      >
                        <span className="text-xs" style={{ color: 'var(--mark-blue)' }}>
                          正在查看历史版本 {preview.commitHash.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            className="text-xs font-medium"
                            style={{ color: 'var(--mark-blue)' }}
                            onClick={() => void handlePublishVersion(detail.id, preview.commitHash)}
                          >
                            发布此版本
                          </button>
                          <button
                            className="text-xs font-medium"
                            style={{ color: 'var(--mark-blue)' }}
                            onClick={() => setPreview(null)}
                          >
                            返回最新 →
                          </button>
                        </div>
                      </div>
                    )}
                    <GalleryPostPreview
                      post={preview ? { ...detail, title: preview.title, description: preview.description } : detail}
                      onPhotoClick={preview ? undefined : (index) => { setModalPhotoIndex(index); setModalOpen(true); }}
                      onPublish={preview ? undefined : () => void handlePublish(detail.id)}
                      onUnpublish={preview ? undefined : () => void handleUnpublish(detail.id)}
                      onDelete={preview ? undefined : () => void handleDelete(detail.id)}
                    />
                  </>
                ) : (
                  <EmptyState message="选择一条动态，或点击新建" />
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* 右侧信息栏（与 note 管理端右栏对齐） */}
          {detail && (
            <aside
              className="flex w-[280px] shrink-0 flex-col overflow-y-auto px-5 py-7"
              style={{ borderLeft: '0.5px solid var(--separator)' }}
            >
              {/* 信息 */}
              <div className="mb-5">
                <SectionTitle>信息</SectionTitle>
                <div className="space-y-2.5">
                  <InfoRow label="状态" value={detail.status === 'published' ? '已发布' : '草稿'} />
                  <InfoRow label="照片" value={`${detail.photos.length} 张`} />
                  {detail.tags?.location && <InfoRow label="地点" value={detail.tags.location} />}
                  <InfoRow label="创建" value={new Date(detail.createdAt).toLocaleDateString('zh-CN')} />
                  <InfoRow label="更新" value={new Date(detail.updatedAt).toLocaleString('zh-CN')} />
                </div>
              </div>

              {/* 编辑（跟 note 一样的草稿入口卡片） */}
              <div className="mb-5">
                <SectionTitle>编辑</SectionTitle>
                <div
                  className="rounded-[10px] p-4"
                  style={{ border: '1px solid var(--box-border)', background: 'var(--shelf)' }}
                >
                  {draftInfo.exists ? (
                    <div className="space-y-2">
                      <InfoRow label="未保存的编辑" value="是" />
                      <InfoRow
                        label="上次编辑"
                        value={draftInfo.savedAt ? new Date(draftInfo.savedAt).toLocaleString('zh-CN') : '--'}
                      />
                      <div className="flex gap-4 pt-2">
                        <button
                          className="text-xs font-medium"
                          style={{ color: 'var(--ink)' }}
                          onClick={() => navigate(`/admin/gallery/edit/${detail.id}`)}
                        >
                          继续编辑 →
                        </button>
                        <button
                          className="text-xs font-medium"
                          style={{ color: 'var(--mark-red)' }}
                          onClick={() => void handleDiscardDraft(detail.id)}
                        >
                          丢弃
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
                        进入编辑器修改照片和随笔
                      </p>
                      <button
                        className="text-xs font-medium"
                        style={{ color: 'var(--ink)' }}
                        onClick={() => navigate(`/admin/gallery/edit/${detail.id}`)}
                      >
                        开始编辑 →
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 版本历史 */}
              <div className="flex min-h-0 flex-1 flex-col">
                <SectionTitle>版本</SectionTitle>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {historyLoading ? (
                    <LoadingState />
                  ) : history.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无版本</p>
                  ) : (
                    <VersionTimeline
                      history={history}
                      publishedHash={detail.publishedCommitHash ?? null}
                      activePreviewHash={preview?.commitHash ?? null}
                      onSelect={(hash) => void handlePreviewVersion(hash)}
                    />
                  )}
                </div>
              </div>

            </aside>
          )}
        </div>
      </div>

      {/* 照片大图预览 */}
      {detail && (
        <PhotoLightbox
          open={modalOpen}
          urls={detail.photos.map((p) => p.url)}
          initialIndex={modalPhotoIndex}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

/* ─── 右栏辅助组件 ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2.5 text-2xs font-semibold uppercase"
      style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>{label}</div>
      <div className="mt-0.5 text-xs font-medium" style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  );
}

/* ─── 版本时间线（与 note 管理端 VersionTimeline 样式一致） ─── */

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
      {/* 纵线 */}
      <div
        className="absolute"
        style={{ left: 7, top: 8, bottom: 8, width: 1, background: 'var(--box-border)' }}
      />
      {history.map((entry, i) => {
        const isPublished = publishedHash === entry.commitHash;
        const isFirst = i === 0;
        const isActive = activePreviewHash
          ? activePreviewHash === entry.commitHash
          : isFirst;
        const title = entry.message.split(' | ')[1]?.trim()
          || (entry.action === 'commit' ? '版本提交' : '版本更新');

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
            {/* 节点圆点 */}
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
              style={{
                color: isFirst ? 'var(--ink)' : 'var(--ink-light)',
                fontSize: 'var(--text-xs)',
                marginBottom: 3,
              }}
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
