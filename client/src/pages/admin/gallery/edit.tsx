/*
 * GalleryEditPage — 画廊动态编辑页 (/admin/gallery/edit/:id | /admin/gallery/new)
 *
 * 布局：
 *   Topbar（主题切换）
 *   顶部导航栏：← 返回 | 标题输入 | 保存状态 | 保存/创建按钮
 *   滚动内容区（max-w-[520px] 居中）：PhotoGrid + GalleryProseEditor + LocationSelect
 *   PhotoEditModal（照片详情弹窗）
 *
 * 新建场景：id 为 undefined（路由 /admin/gallery/new），
 * 点击"创建"时调用 createPost()，创建成功后 replace 导航到编辑页。
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Topbar from '@/components/global/Topbar';
import { LoadingState } from '@/components/LoadingState';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoEditModal } from './components/PhotoEditModal';
import { GalleryProseEditor } from './components/GalleryProseEditor';
import { LocationSelect } from './components/LocationSelect';
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
    createPost,
  } = useGalleryEditor(id);

  // 照片编辑弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);

  const handlePhotoClick = (index: number) => {
    setModalPhotoIndex(index);
    setModalOpen(true);
  };

  // 新建 vs 保存
  const handleSave = async () => {
    if (!id) {
      // 新建场景：创建帖子，跳转到编辑页
      try {
        const newId = await createPost();
        navigate(`/admin/gallery/edit/${newId}`, { replace: true });
      } catch {
        /* createPost 内部已 toast.error，无需重复处理 */
      }
    } else {
      await save();
      navigate(`/admin/gallery?post=${id}`);
    }
  };

  if (loading) {
    return <LoadingState variant="full" />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 主题切换 Topbar */}
      <Topbar />

      {/* 顶部导航栏：← / 标题 / 状态 / 按钮 */}
      <div
        className="flex shrink-0 items-center gap-3 px-4"
        style={{ height: 48, borderBottom: '0.5px solid var(--separator)' }}
      >
        {/* 左侧：← / 标题（与 note 编辑器导航一致） */}
        <button
          className="hover-shelf shrink-0 rounded-md px-2 py-1 transition-colors duration-150"
          style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}
          onClick={() => navigate(id ? `/admin/gallery?post=${id}` : '/admin/gallery')}
          aria-label="返回画廊列表"
        >
          ←
        </button>
        <span className="shrink-0" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>/</span>
        <input
          type="text"
          value={title}
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="无标题"
          className="w-[160px] shrink-0 truncate border-none bg-transparent font-medium outline-none placeholder:text-[var(--ink-ghost)]"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-base)' }}
        />

        {/* 中间留白 */}
        <div className="min-w-0 flex-1" />

        {/* 右侧：保存状态 + 操作按钮 */}
        <div className="flex shrink-0 items-center gap-3">
          {/* 新建场景下无需展示自动保存状态 */}
          {id && <SaveStatusBadge status={saveStatus} />}

          <button
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            onClick={() => void handleSave()}
          >
            {id ? '保存' : '创建'}
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
            onUpload={async (files) => {
              /* 新建场景：先创建动态拿到 ID，再上传照片 */
              if (!id) {
                try {
                  const newId = await createPost();
                  navigate(`/admin/gallery/edit/${newId}`, { replace: true });
                } catch { return; }
              }
              void uploadPhotos(files);
            }}
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
    </div>
  );
}
