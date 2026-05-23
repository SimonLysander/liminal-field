/*
 * GalleryEditPage — 画廊动态编辑页 (/admin/gallery/:id/edit)
 *
 * 布局：
 *   浮动胶囊顶栏（左：导航，右：主题切换 + 操作按钮）
 *   滚动内容区（--layout-reading-max 居中）：PhotoGrid + GalleryProseEditor + LocationSelect
 *   PhotoEditModal（照片详情弹窗）
 *
 * 进入此页面时 id 必定存在（从列表页 Modal 创建后跳转而来）。
 * 所有编辑通过 draft 自动保存，"提交"触发首次/新版本 Git commit。
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { LoadingState } from '@/components/LoadingState';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoEditModal } from './components/PhotoEditModal';
import { GalleryProseEditor } from './components/GalleryProseEditor';
import { MetadataFields } from './components/LocationSelect';
import { CommitPopover } from './components/CommitPopover';
import { useGalleryEditor } from './hooks/useGalleryEditor';

// ─── 保存状态展示 ───

/*
 * SaveStatusBadge — 右侧小徽章，颜色 + 文案传达当前保存状态：
 *   saved  → 绿色  ✓ 已自动保存
 *   dirty  → 橙色  ● 有未保存的更改
 *   saving → 灰色  ↻ 保存中...
 */
function SaveStatusBadge({ status }: { status: 'saved' | 'dirty' | 'saving' }) {
  const config = {
    saved:  { symbol: '✓', text: '已自动保存', color: 'var(--mark-green)' },
    dirty:  { symbol: '●', text: '有未保存的更改', color: 'var(--mark-orange, #f59e0b)' },
    saving: { symbol: '↻', text: '保存中...', color: 'var(--ink-ghost)' },
  } as const;

  const { symbol, text, color } = config[status];

  return (
    <span className="flex items-center gap-1 text-xs" style={{ color }}>
      <span>{symbol}</span>
      <span>{text}</span>
    </span>
  );
}

// ─── 页面主体 ───

export default function GalleryEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const {
    loading,
    title,
    prose,
    photos,
    date,
    location,
    saveStatus,
    updateTitle,
    updateProse,
    reorderPhotos,
    updateCaption,
    updatePhotoTags,
    uploadPhotos,
    uploadProgress,
    deletePhoto,
    setCover,
    updateDate,
    updateLocation,
    save,
    commit,
  } = useGalleryEditor(id);

  const uploading = uploadProgress !== null;

  // 上传中阻止离开：beforeunload（刷新/关闭）+ popstate（浏览器后退）+ safeNavigate（返回按钮）
  useEffect(() => {
    if (!uploading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 压入一条 history 条目，后退时触发 popstate 而不是真正离开
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      if (window.confirm('照片正在上传中，离开将中断上传。确认离开？')) {
        window.history.back();
      } else {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [uploading]);

  const safeNavigate = (to: string) => {
    if (uploading && !window.confirm('照片正在上传中，离开将中断上传。确认离开？')) return;
    navigate(to);
  };

  // Portal 目标：随笔工具栏渲染到 topbar 中间
  const [toolbarPortal, setToolbarPortal] = useState<HTMLDivElement | null>(null);
  // 照片编辑弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);

  const handlePhotoClick = (index: number) => {
    setModalPhotoIndex(index);
    setModalOpen(true);
  };

  // 提交：Modal 输入变更说明 → Git commit → 跳回列表页
  const handleCommit = async (changeNote: string) => {
    await commit(changeNote);
    navigate(`/admin/gallery?post=${id}`);
  };

  if (loading) {
    return <LoadingState variant="full" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* 顶栏：1fr | auto | 1fr 工具栏居中（与 notes 编辑器一致） */}
      <header
        className="grid shrink-0 items-center"
        style={{ height: 48, padding: '8px 16px', gridTemplateColumns: '1fr auto 1fr', columnGap: 12 }}
      >
        {/* 左侧胶囊：← 返回 / 标题输入 */}
        <div
          className="flex min-w-0 shrink-0 items-center justify-self-start gap-2 px-3 py-1"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            border: '1px solid var(--glass-border)',
            borderRadius: 20,
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <button
            className="hover-shelf shrink-0 rounded-full px-1.5 py-0.5 transition-colors duration-150"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => safeNavigate(`/admin/gallery?post=${id}`)}
            aria-label="返回画廊列表"
          >
            ←
          </button>
          <span className="shrink-0 text-base" style={{ color: 'var(--ink-ghost)' }}>/</span>
          <input
            type="text"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="无标题"
            className="w-[160px] shrink-0 truncate border-none bg-transparent text-base font-medium outline-none placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        {/* 工具栏 Portal 挂在中列 */}
        <div
          ref={setToolbarPortal}
          className="flex min-w-0 max-w-full justify-center justify-self-center overflow-x-auto"
        />

        {/* 右侧胶囊：保存状态 + 主题切换 + 操作按钮 */}
        <div
          className="flex min-w-0 shrink-0 items-center justify-self-end gap-3 px-3 py-1"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            border: '1px solid var(--glass-border)',
            borderRadius: 20,
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <SaveStatusBadge status={saveStatus} />

          {/* 主题切换按钮：亮色模式显示 Sun，暗色模式显示 Moon */}
          <button
            className="hover-shelf flex items-center rounded-full p-1 transition-colors duration-150"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}
            aria-label="切换主题"
          >
            <Sun size={14} strokeWidth={1.5} className="theme-icon-light" />
            <Moon size={14} strokeWidth={1.5} className="theme-icon-dark" />
          </button>

          <button
            className="rounded-full px-3 py-1 text-sm transition-colors duration-150"
            style={{ color: 'var(--ink-faded)', border: '0.5px solid var(--separator)', opacity: uploading ? 0.4 : 1 }}
            onClick={() => void save()}
            disabled={uploading}
          >
            保存草稿
          </button>
          {/* 提交就近浮层:以「提交」按钮为锚点弹出 */}
          <CommitPopover onSubmit={handleCommit}>
            <button
              className="rounded-full px-3 py-1 text-sm font-medium transition-colors duration-150"
              style={{ background: 'var(--ink)', color: 'var(--paper)', opacity: uploading ? 0.4 : 1 }}
              disabled={uploading}
            >
              提交
            </button>
          </CommitPopover>
        </div>
      </header>

      {/* 上传进度条 — 2px 细线贴在 topbar 底部 */}
      {uploading && (
        <div className="h-0.5 shrink-0" style={{ background: 'var(--separator)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${Math.round((uploadProgress.uploaded / uploadProgress.total) * 100)}%`,
              background: 'var(--ink)',
            }}
          />
        </div>
      )}

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[var(--layout-reading-max)] flex-col gap-5 px-10 py-6 max-[520px]:px-4">
          {/* 照片网格 */}
          <PhotoGrid
            photos={photos}
            uploadProgress={uploadProgress}
            onReorder={reorderPhotos}
            onPhotoClick={handlePhotoClick}
            onDelete={deletePhoto}
            onUpload={(files) => void uploadPhotos(files)}
          />

          {/* 日期 + 地点 */}
          <MetadataFields
            date={date}
            location={location}
            onDateChange={updateDate}
            onLocationChange={updateLocation}
          />

          {/* 随笔编辑区（无框，工具栏已 Portal 到 topbar） */}
          <GalleryProseEditor
            initialMarkdown={prose}
            onChange={updateProse}
            toolbarContainer={toolbarPortal}
          />
        </div>
      </div>

      {/* 照片编辑弹窗 */}
      <PhotoEditModal
        open={modalOpen}
        photos={photos}
        initialIndex={modalPhotoIndex}
        onClose={() => setModalOpen(false)}
        onCaptionChange={updateCaption}
        onTagsChange={updatePhotoTags}
        onSetCover={setCover}
        onDelete={deletePhoto}
      />

    </div>
  );
}
