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
import { banner } from '@/components/ui/banner-api';

import { LoadingState, ContentFade } from '@/components/LoadingState';
import { useConfirm } from '@/contexts/ConfirmContext';
import { galleryApi, type GalleryAdminListItem, type GalleryAdminDetail, type ContentHistoryEntry } from '@/services/workspace';
import { smoothBounce } from '@/lib/motion';
import { GalleryPostListItem, GalleryPostPreview } from './components/GalleryFeedCard';
import { PhotoLightbox } from './components/PhotoLightbox';
import { CreateGalleryPopover } from './components/CreateGalleryPopover';
import { VersionTimeline } from '../components/VersionTimeline';

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

  const loadPosts = useCallback(async () => {
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
      banner.error('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSelectedId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /* set-state-in-effect：首帧 setState 推迟到微任务后，避免与 effect 同步阶段叠连 render */
      await Promise.resolve();
      if (cancelled) return;
      await loadPosts();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPosts]);

  /* 草稿状态 */
  const [draftInfo, setDraftInfo] = useState<{ exists: boolean; savedAt?: string }>({ exists: false });

  /* 版本历史 */
  const [history, setHistory] = useState<ContentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* 版本预览：点击历史版本时加载该版本的内容 */
  const [preview, setPreview] = useState<{
    versionId: string;
    title: string;
    prose: string;
    photos: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  } | null>(null);

  /* 选中帖子变化时并行加载：详情 + 草稿 + 版本历史 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!selectedId) {
        setDetail(null);
        setDraftInfo({ exists: false });
        setHistory([]);
        setPreview(null);
        return;
      }
      setDetailLoading(true);
      setHistoryLoading(true);

      try {
        const [d, draft, hist] = await Promise.all([
          galleryApi.getById(selectedId),
          galleryApi.getDraft(selectedId).catch(() => null),
          galleryApi.getHistory(selectedId).catch(() => []),
        ]);
        if (cancelled) return;
        setDetail(d);
        setDraftInfo(draft ? { exists: true, savedAt: draft.savedAt } : { exists: false });
        setHistory(hist);
      } catch (err) {
        console.error('[GalleryAdmin] 加载动态详情失败:', err);
        // 详情加载失败时静默重置状态
        if (!cancelled) {
          setDetail(null);
          setDraftInfo({ exists: false });
          setHistory([]);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── 操作处理 ───

  /** 切换版本预览：点击历史版本节点 */
  const handlePreviewVersion = async (versionId: string) => {
    if (!selectedId) return;
    /* 如果点的是最新版本（history[0] 的 versionId），退出预览模式 */
    if (history[0]?.versionId === versionId) {
      setPreview(null);
      return;
    }
    try {
      const ver = await galleryApi.getByVersion(selectedId, versionId);
      setPreview({
        versionId: ver.versionId,
        title: ver.title,
        prose: ver.prose,
        photos: ver.photos,
      });
    } catch {
      banner.error('加载版本失败');
    }
  };

  /** 刷新选中帖子的详情 + 历史（发布/取消发布/提交后调用） */
  const reloadDetail = async (id: string) => {
    try {
      const [d, hist] = await Promise.all([
        galleryApi.getById(id),
        galleryApi.getHistory(id).catch(() => []),
      ]);
      setDetail(d);
      setHistory(hist);
    } catch (err) {
      console.error('[GalleryAdmin] 重载详情失败:', err);
      // 刷新详情失败时保留当前已展示的数据
    }
  };

  /** 发布当前展示的版本，返回 true 表示成功（ActionButton ✓ 反馈） */
  const handlePublish = async (id: string): Promise<boolean> => {
    const versionId = preview?.versionId;
    const label = versionId ? `版本 ${versionId.slice(0, 8)}` : '最新版本';
    const ok = await confirm({ title: '发布', message: `立即发布${label}？`, confirmLabel: '发布' });
    if (!ok) return false;
    try {
      await galleryApi.publish(id, versionId);
      void loadPosts();
      void reloadDetail(id);
      return true;
    } catch {
      banner.error('发布失败');
      return false;
    }
  };

  const handleUnpublish = async (id: string): Promise<boolean> => {
    const ok = await confirm({ title: '取消发布', message: '立即取消发布？', danger: true, confirmLabel: '取消发布' });
    if (!ok) return false;
    try {
      await galleryApi.unpublish(id);
      void loadPosts();
      void reloadDetail(id);
      return true;
    } catch {
      banner.error('取消发布失败');
      return false;
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: '删除', message: '确认删除此动态？此操作不可撤销。', danger: true, confirmLabel: '删除' });
    if (!ok) return;
    try {
      await galleryApi.remove(id);
      if (selectedId === id) setSelectedId(null);
      void loadPosts();
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '删除失败');
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
        className="flex shrink-0 flex-col overflow-hidden"
        style={{
          width: 'var(--layout-sidebar)',
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
          <CreateGalleryPopover onSubmit={handleCreate}>
            <button
              className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base font-medium transition-colors duration-150"
              style={{ color: 'var(--ink)' }}
            >
              <Plus size={10} strokeWidth={2} />
              新建
            </button>
          </CreateGalleryPopover>
        </div>
      </aside>

      {/* ── 右侧：内容预览 + 信息侧栏(Topbar 退役, 主题切换在 IconRail 底) ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          {/* 中间：内容预览 */}
          <main
            className="relative z-0 flex max-[520px]:px-4 flex-1 overflow-y-auto px-10 py-9"
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
                  const viewingVersionId = preview?.versionId ?? history[0]?.versionId ?? '';
                  const isViewingPublished = preview
                    ? preview.versionId === detail.publishedVersionId
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
                        url: existing?.url ?? `/api/v1/spaces/gallery/items/${detail.id}/assets/${p.file}?v=${preview.versionId}`,
                        size: existing?.size ?? 0,
                        caption: p.caption,
                        tags: p.tags,
                      };
                    }),
                    photoCount: preview.photos.length,
                  } : detail;

                  return (
                    <GalleryPostPreview
                      post={displayPost}
                      isViewingHistory={isViewingHistory}
                      isViewingPublished={isViewingPublished}
                      viewingHash={viewingVersionId ?? ''}
                      onExitPreview={() => setPreview(null)}
                      onPhotoClick={preview ? undefined : (index) => { setModalPhotoIndex(index); setModalOpen(true); }}
                      onPublish={() => handlePublish(detail.id)}
                      onUnpublish={() => handleUnpublish(detail.id)}
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
              className="flex shrink-0 flex-col overflow-y-auto px-5 py-7"
              style={{ width: 'var(--layout-context)', borderLeft: '0.5px solid var(--separator)' }}
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
                      publishedVersionId={detail.publishedVersionId ?? null}
                      activeVersionId={preview?.versionId ?? null}
                      onSelect={(versionId) => void handlePreviewVersion(versionId)}
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

