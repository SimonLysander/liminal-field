// src/pages/admin/gallery/components/PhotoEditModal.tsx

/*
 * PhotoEditModal — 照片详情编辑弹窗
 *
 * 布局规则（由图片方向决定）：
 *   横幅（宽 >= 高）：flex-col，照片区全宽上方，信息区下方
 *   竖幅（高 > 宽）：flex-row，照片区左侧 320px，信息区右侧 flex-1
 *
 * 信息区从上到下：
 *   1. 关闭按钮（右上角 X）
 *   2. Caption textarea + 字符计数
 *   3. EXIF 汇总行（只读，点击展开 inline 编辑网格）
 *   4. 文件信息（底部小字）
 *   5. 操作栏：左"设为封面"，右"完成"
 *
 * 交互细节：
 *   - captionDraft 非受控，切换照片/失焦时提交
 *   - isEditingExif 控制 EXIF 区展开/收起，切换照片时自动收起
 *   - 删除按钮已移除（后续放到网格右键菜单）
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, Camera, Aperture, CalendarDays } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PhotoMetadataFields } from './LocationSelect';

// ---------- Props ----------

/** 照片编辑弹窗所需的照片数据（需要 size 用于文件信息展示） */
interface PhotoForEdit {
  id: string;
  url: string;
  fileName: string;
  size: number;
  caption: string;
  tags: Record<string, string>;
}

interface PhotoEditModalProps {
  open: boolean;
  photos: PhotoForEdit[];
  initialIndex: number;
  onClose: () => void;
  onCaptionChange: (photoId: string, caption: string) => void;
  onTagsChange: (photoId: string, tags: Record<string, string>) => void;
  onSetCover: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}

// ---------- Helpers ----------

/*
 * 将字节数格式化为可读的文件大小字符串。
 * 小于 1 MB 时显示 KB，否则显示 MB（保留一位小数）。
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- EXIF 汇总行组件 ----------

/*
 * ExifSummary — 紧凑只读展示，3 行 icon+文字。
 * 点击任意行触发 onEdit 展开为编辑网格。
 *
 * 行规则：有值才渲染，全空时显示占位文字。
 */
interface ExifSummaryProps {
  tags: Record<string, string>;
  onEdit: () => void;
}

function ExifSummary({ tags, onEdit }: ExifSummaryProps) {
  /* 设备行：device + lens（或 focalLength） */
  const deviceParts = [tags.device, tags.lens || tags.focalLength].filter(Boolean);
  const deviceLine = deviceParts.length > 0 ? deviceParts.join(' · ') : null;

  /* 曝光行：aperture + shutter + ISO */
  const exposureParts = [
    tags.aperture,
    tags.shutter,
    tags.iso ? `ISO ${tags.iso}` : undefined,
  ].filter(Boolean);
  const exposureLine = exposureParts.length > 0 ? exposureParts.join(' · ') : null;

  /* 日期行 */
  const dateLine = tags.shotAt ?? null;

  const hasAnyExif = deviceLine || exposureLine || dateLine;

  return (
    <button
      className="w-full cursor-pointer rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--shelf)]"
      onClick={onEdit}
      aria-label="编辑拍摄参数"
    >
      {hasAnyExif ? (
        <div className="flex flex-col gap-1">
          {deviceLine && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
              <Camera size={12} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
              <span>{deviceLine}</span>
            </div>
          )}
          {exposureLine && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
              <Aperture size={12} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
              <span>{exposureLine}</span>
            </div>
          )}
          {dateLine && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
              <CalendarDays size={12} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)', flexShrink: 0 }} />
              <span>{dateLine}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          <Camera size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          <span>暂无拍摄参数</span>
        </div>
      )}
    </button>
  );
}

// ---------- Component ----------

export function PhotoEditModal({
  open,
  photos,
  initialIndex,
  onClose,
  onCaptionChange,
  onTagsChange,
  onSetCover,
}: PhotoEditModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  /* 图片方向：横幅上下布局，竖幅左右布局 */
  const [isLandscape, setIsLandscape] = useState(true);
  /* EXIF 编辑态：false = 汇总只读，true = 展开 inline 编辑 */
  const [isEditingExif, setIsEditingExif] = useState(false);

  /*
   * 当 initialIndex 或 open 变化时同步内部索引。
   * 这样从外部重新打开弹窗时总能定位到正确的照片。
   */
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, open]);

  const photo = photos[currentIndex];

  /* 检测图片方向：加载后比较 naturalWidth / naturalHeight */
  useEffect(() => {
    if (!photo) return;
    const img = new Image();
    img.onload = () => setIsLandscape(img.naturalWidth >= img.naturalHeight);
    img.src = photo.url;
  }, [photo?.url]);

  /* 切换照片时关闭 EXIF 编辑态 */
  useEffect(() => {
    setIsEditingExif(false);
  }, [photo?.id]);

  /*
   * captionDraft：本地草稿，避免每次按键都触发父级回调。
   * 切换照片时提交上一张的 caption，打开时用当前 photo.caption 初始化。
   */
  const [captionDraft, setCaptionDraft] = useState(photo?.caption ?? '');
  const prevPhotoIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!photo) return;

    /*
     * 切换到新照片时，先将上一张的 caption 提交，再初始化草稿。
     * 首次挂载时 prevPhotoIdRef 为 null，跳过提交。
     */
    if (prevPhotoIdRef.current && prevPhotoIdRef.current !== photo.id) {
      const prevPhoto = photos.find((p) => p.id === prevPhotoIdRef.current);
      if (prevPhoto) {
        onCaptionChange(prevPhoto.id, captionDraft);
      }
    }

    prevPhotoIdRef.current = photo.id;
    setCaptionDraft(photo.caption ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id]);

  if (!photo) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const goToPrev = () => {
    if (hasPrev) setCurrentIndex((i) => i - 1);
  };

  const goToNext = () => {
    if (hasNext) setCurrentIndex((i) => i + 1);
  };

  /* 关闭前提交当前 caption */
  const handleClose = () => {
    onCaptionChange(photo.id, captionDraft);
    onClose();
  };

  const handleSetCover = () => {
    onSetCover(photo.id);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      {/*
       * 覆盖 DialogContent 的默认样式：
       * - 最大宽度扩大到 760px，去掉 gap / padding，使左右两侧各自控制内边距
       * - 隐藏 shadcn 内置的关闭按钮（右侧 header 有自定义关闭按钮）
       * - 使用 [&>button:last-child]:hidden 隐藏 DialogPrimitive.Close
       */}
      <DialogContent
        className={`flex overflow-hidden p-0 [&>button:last-child]:hidden ${isLandscape ? 'flex-col' : 'flex-row'}`}
        style={{
          maxWidth: '760px',
          width: '760px',
          borderRadius: '12px',
          border: 'none',
        }}
      >
        {/* ── 照片预览区：横幅在上方（全宽），竖幅在左侧（固定宽） ── */}
        <div
          className={`relative flex shrink-0 items-center justify-center ${isLandscape ? 'w-full' : 'w-[320px]'}`}
          style={{
            background: 'var(--shelf)',
            ...(isLandscape ? { height: '340px' } : { minHeight: '480px' }),
          }}
        >
          {/* 大图预览 */}
          <img
            src={photo.url}
            alt={photo.fileName}
            className="h-full w-full object-contain"
            style={isLandscape ? { maxHeight: '320px' } : { maxHeight: '420px' }}
            draggable={false}
          />

          {/* 左箭头 — 仅有上一张时显示 */}
          {hasPrev && (
            <button
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors duration-150"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
              onClick={goToPrev}
              aria-label="上一张"
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
          )}

          {/* 右箭头 — 仅有下一张时显示 */}
          {hasNext && (
            <button
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors duration-150"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
              onClick={goToNext}
              aria-label="下一张"
            >
              <ChevronRight size={18} strokeWidth={2} />
            </button>
          )}

          {/* 底部计数器 pill */}
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-xs"
            style={{
              background: 'rgba(0,0,0,0.45)',
              color: 'rgba(255,255,255,0.85)',
              letterSpacing: '0.04em',
              userSelect: 'none',
            }}
          >
            {currentIndex + 1} / {photos.length}
          </div>
        </div>

        {/* ── 信息区（横幅在下方，竖幅在右侧）── */}
        <div
          className="flex flex-1 flex-col"
          style={{ background: 'var(--paper)' }}
        >
          {/* 关闭按钮 — 右上角，无标题 */}
          <div className="flex items-center justify-end px-5 pt-4 pb-2">
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={handleClose}
              aria-label="关闭"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          <div style={{ height: '0.5px', background: 'var(--separator)', margin: '0 20px' }} />

          {/* Caption — 最突出的输入区，紧接分割线 */}
          <div className="px-5 pt-4">
            <div className="relative">
              <textarea
                className="w-full resize-none rounded-md px-3 py-2.5 text-sm outline-none transition-colors duration-150"
                style={{
                  background: 'var(--shelf)',
                  color: 'var(--ink)',
                  border: '1px solid var(--separator)',
                  minHeight: '72px',
                }}
                placeholder="添加说明..."
                maxLength={30}
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value)}
                /* 失焦时立即提交，确保用户切换方式不是翻页时也能保存 */
                onBlur={() => onCaptionChange(photo.id, captionDraft)}
              />
              {/* 字符计数：右下角，达到上限时变红 */}
              <div
                className="absolute bottom-2 right-3 text-2xs"
                style={{
                  color: captionDraft.length >= 30 ? 'var(--mark-red)' : 'var(--ink-ghost)',
                  pointerEvents: 'none',
                }}
              >
                {captionDraft.length} / 30
              </div>
            </div>
          </div>

          {/* EXIF 区 — 默认只读汇总，点击展开为编辑网格 */}
          <div className="flex-1 px-5 pt-3">
            {isEditingExif ? (
              /*
               * 展开态：用 PhotoMetadataFields（6 字段网格）inline 编辑。
               * 点击区域外（onBlur 无法完美捕获 grid 内部切换），
               * 改为顶部加一个"收起"按钮。
               */
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-2xs font-semibold uppercase" style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}>
                    拍摄参数
                  </span>
                  <button
                    className="text-2xs transition-opacity hover:opacity-70"
                    style={{ color: 'var(--ink-ghost)' }}
                    onClick={() => setIsEditingExif(false)}
                  >
                    收起
                  </button>
                </div>
                <PhotoMetadataFields
                  tags={photo.tags}
                  onChange={(tags) => onTagsChange(photo.id, tags)}
                />
              </div>
            ) : (
              /* 收起态：紧凑只读展示，点击进入编辑 */
              <ExifSummary tags={photo.tags} onEdit={() => setIsEditingExif(true)} />
            )}
          </div>

          {/* 文件信息 — 底部小字灰色 */}
          <div className="px-5 pt-2 pb-1">
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              {photo.fileName} · {formatFileSize(photo.size)}
            </span>
          </div>

          {/* 操作栏：左"设为封面"，右"完成" */}
          <div className="flex items-center justify-between px-5 py-4">
            <button
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
              }}
              onClick={handleSetCover}
            >
              设为封面
            </button>

            <button
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
              }}
              onClick={handleClose}
            >
              完成
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
