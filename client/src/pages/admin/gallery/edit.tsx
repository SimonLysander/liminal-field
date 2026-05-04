/*
 * GalleryEditPage — 画廊动态编辑页 (/admin/gallery/:id/edit)
 *
 * 布局：
 *   浮动胶囊顶栏（左：导航，右：主题切换 + 操作按钮）
 *   滚动内容区（max-w-[740px] 居中）：PhotoGrid + GalleryProseEditor + LocationSelect
 *   PhotoEditModal（照片详情弹窗）
 *
 * 进入此页面时 id 必定存在（从列表页 Modal 创建后跳转而来）。
 * 所有编辑通过 draft 自动保存，"提交"触发首次/新版本 Git commit。
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { LoadingState } from '@/components/LoadingState';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoEditModal } from './components/PhotoEditModal';
import { GalleryProseEditor } from './components/GalleryProseEditor';
import { LocationSelect } from './components/LocationSelect';
import { CommitModal } from './components/CommitModal';
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
    tags,
    saveStatus,
    updateTitle,
    updateProse,
    reorderPhotos,
    updateCaption,
    uploadPhotos,
    deletePhoto,
    setCover,
    updateLocation,
    save,
    commit,
  } = useGalleryEditor(id);

  // 照片编辑弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);
  // 提交 Modal 状态
  const [commitModalOpen, setCommitModalOpen] = useState(false);

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
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 顶栏：两组胶囊左右分布 */}
      <div className="flex shrink-0 items-center justify-between px-4" style={{ height: 48 }}>
        {/* 左侧胶囊：← 返回 / 标题输入 */}
        <div
          className="flex items-center gap-2 px-3 py-1"
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
            onClick={() => navigate(`/admin/gallery?post=${id}`)}
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

        {/* 右侧胶囊：保存状态 + 主题切换 + 操作按钮 */}
        <div
          className="flex items-center gap-3 px-3 py-1"
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
            style={{ color: 'var(--ink-faded)', border: '0.5px solid var(--separator)' }}
            onClick={() => void save()}
          >
            保存草稿
          </button>
          <button
            className="rounded-full px-3 py-1 text-sm font-medium transition-colors duration-150"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            onClick={() => setCommitModalOpen(true)}
          >
            提交
          </button>
        </div>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[740px] px-10 py-6 flex flex-col gap-5">
          {/* 照片网格 */}
          <PhotoGrid
            photos={photos}
            onReorder={reorderPhotos}
            onPhotoClick={handlePhotoClick}
            onUpload={(files) => void uploadPhotos(files)}
          />

          {/* 随笔编辑器 */}
          <GalleryProseEditor
            initialMarkdown={prose}
            onChange={updateProse}
          />

          {/* 地点选择 */}
          <LocationSelect
            value={tags['location']}
            onChange={updateLocation}
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
        onSetCover={setCover}
        onDelete={deletePhoto}
      />

      {/* 提交 Modal */}
      <CommitModal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        onSubmit={handleCommit}
      />
    </div>
  );
}
