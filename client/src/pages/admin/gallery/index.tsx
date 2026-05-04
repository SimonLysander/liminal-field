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
import { useConfirm } from '@/contexts/ConfirmContext';
import { galleryApi, type GalleryAdminListItem, type GalleryAdminDetail, type ContentHistoryEntry } from '@/services/workspace';
import { smoothBounce } from '@/lib/motion';
import { GalleryPostListItem, GalleryPostPreview } from './components/GalleryFeedCard';
import { PhotoLightbox } from './components/PhotoLightbox';
import { CreateGalleryModal } from './components/CreateGalleryModal';

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
  const confirm = useConfirm();

  const [posts, setPosts] = useState<GalleryAdminListItem[]>([]);
  const [loading, setLoading] = useState(true);

  /* 新建 Modal */
  const [createModalOpen, setCreateModalOpen] = useState(false);

  /* 选中帖子的完整详情（含所有照片） */
  const [detail, setDetail] = useState<GalleryAdminDetail | null>(null);
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
  const [preview, setPreview] = useState<{
    commitHash: string;
    title: string;
    prose: string;
    photos: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  } | null>(null);

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
      const ver = await galleryApi.getByVersion(selectedId, commitHash);
      setPreview({
        commitHash: ver.commitHash,
        title: ver.title,
        prose: ver.prose,
        photos: ver.photos,
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

  /** 发布当前展示的版本：preview 模式发布历史版本，否则发布最新版 */
  const handlePublish = async (id: string) => {
    const commitHash = preview?.commitHash;
    const label = commitHash ? `版本 ${commitHash.slice(0, 8)}` : '最新版本';
    const ok = await confirm({ title: '发布', message: `立即发布${label}？`, confirmLabel: '发布' });
    if (!ok) return;
    try {
      await galleryApi.publish(id, commitHash);
      toast.success(`${label}已发布`);
      // 不清除 preview，保持停留在当前版本
      void loadPosts();
      void reloadDetail(id);
    } catch {
      toast.error('发布失败');
    }
  };

  const handleUnpublish = async (id: string) => {
    const ok = await confirm({ title: '取消发布', message: '立即取消发布？', danger: true, confirmLabel: '取消发布' });
    if (!ok) return;
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
    const ok = await confirm({ title: '删除', message: '确认删除此动态？此操作不可撤销。', danger: true, confirmLabel: '删除' });
    if (!ok) return;
    try {
      await galleryApi.remove(id);
      toast.success('已删除');
      if (selectedId === id) setSelectedId(null);
      void loadPosts();
    } catch {
      toast.error('删除失败');
    }
  };

  /** 新建：Modal 输入标题 → 创建 content item（仅 MongoDB）→ 进入编辑器 */
  const handleCreate = async (title: string) => {
    const post = await galleryApi.create({ title, description: '' });
    navigate(`/admin/gallery/${post.id}/edit`);
  };

  /**
   * 跳转编辑页：先卸载预览区（清理 PlateReadOnly 实例），再导航。
   * PlateReadOnly 的全局状态会干扰编辑器的 Plate 实例，导致 inputRules 失效。
   * 通过先置空 detail 触发 React 卸载 PlateReadOnly，下一帧再 navigate。
   */
  const navigateToEdit = useCallback((id: string) => {
    window.location.href = `/admin/gallery/${id}/edit`;
  }, []);

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
            onClick={() => setCreateModalOpen(true)}
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
                ) : detail ? (() => {
                  /*
                   * 判断当前展示的版本是否为已发布版：
                   * - 无 preview（默认视图）→ 用 detail 自身字段判断，不依赖 history 加载状态
                   * - 有 preview → 用 commitHash 对比
                   */
                  const isViewingHistory = !!preview;
                  const viewingHash = preview?.commitHash ?? history[0]?.commitHash ?? '';
                  const isViewingPublished = preview
                    ? preview.commitHash === detail.publishedCommitHash
                    : detail.status === 'published' && !detail.hasUnpublishedChanges;

                  /* 构建当前展示的帖子数据 */
                  const displayPost = preview ? {
                    ...detail,
                    title: preview.title,
                    prose: preview.prose,
                    photos: preview.photos.map((p) => {
                      const existing = detail.photos.find((dp) => dp.fileName === p.file);
                      return {
                        id: p.file,
                        fileName: p.file,
                        // 历史版本照片带 ?v=commitHash，确保从正确的 git commit 读取
                        url: existing?.url ?? `/api/v1/spaces/gallery/items/${detail.id}/assets/${p.file}?v=${preview.commitHash}`,
                        caption: p.caption,
                        tags: p.tags,
                      };
                    }),
                    photoCount: preview.photos.length,
                  } : history.length === 0
                    ? { ...detail, photos: [], prose: '', photoCount: 0 }
                    : detail;

                  return (
                    <GalleryPostPreview
                      post={displayPost}
                      isViewingHistory={isViewingHistory}
                      isViewingPublished={isViewingPublished}
                      viewingHash={viewingHash ?? ''}
                      onExitPreview={() => setPreview(null)}
                      onPhotoClick={preview ? undefined : (index) => { setModalPhotoIndex(index); setModalOpen(true); }}
                      onPublish={() => void handlePublish(detail.id)}
                      onUnpublish={() => void handleUnpublish(detail.id)}
                      onDelete={preview ? undefined : () => void handleDelete(detail.id)}
                    />
                  );
                })() : (
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
                  <InfoRow label="状态" value={detail.status === 'published' ? '已发布' : '待发布'} />
                  <InfoRow label="照片" value={`${detail.photos.length} 张`} />
                  {detail.location && <InfoRow label="地点" value={detail.location} />}
                  <InfoRow label="创建" value={new Date(detail.createdAt).toLocaleDateString('zh-CN')} />
                  <InfoRow label="更新" value={new Date(detail.updatedAt).toLocaleString('zh-CN')} />
                </div>
              </div>

              {/* 编辑（跟 note 一样的草稿入口卡片） */}
              <div className="mb-5">
                <SectionTitle>编辑</SectionTitle>
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
                        onClick={() => navigateToEdit(detail.id)}
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
                      onClick={() => navigateToEdit(detail.id)}
                    >
                      开始编辑 →
                    </button>
                  </>
                )}
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

      {/* 新建 Modal */}
      <CreateGalleryModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreate}
      />
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
