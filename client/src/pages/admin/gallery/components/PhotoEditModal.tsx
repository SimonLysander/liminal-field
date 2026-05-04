// src/pages/admin/gallery/components/PhotoEditModal.tsx

/*
 * PhotoEditModal — 照片详情编辑弹窗
 *
 * 左右布局：
 *   左侧 (320px, 深色背景) — 大图预览 + 翻页箭头 + "1 / N" 计数器
 *   右侧 (flex) — 文件信息、说明文字编辑、操作按钮
 *
 * 设计约定：
 * - currentIndex 由 initialIndex prop 初始化，弹窗内部维护翻页状态
 * - 说明文字采用非受控编辑：用户切换照片时才提交 caption 变更
 * - 删除/设封面/关闭直接调用父级回调，不在此处管理异步状态
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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

// ---------- Component ----------

export function PhotoEditModal({
  open,
  photos,
  initialIndex,
  onClose,
  onCaptionChange,
  onSetCover,
  onDelete,
}: PhotoEditModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  /*
   * 当 initialIndex 或 open 变化时同步内部索引。
   * 这样从外部重新打开弹窗时总能定位到正确的照片。
   */
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, open]);

  const photo = photos[currentIndex];

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
      // 找到上一张照片对象，提交其 caption
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

  const handleDelete = () => {
    onDelete(photo.id);
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
        className="flex overflow-hidden p-0 [&>button:last-child]:hidden"
        style={{
          maxWidth: '760px',
          width: '760px',
          borderRadius: '12px',
          border: 'none',
        }}
      >
        {/* ── 左侧：照片预览区 ── */}
        <div
          className="relative flex w-[320px] shrink-0 items-center justify-center"
          style={{ background: 'var(--shelf)', minHeight: '480px' }}
        >
          {/* 大图预览 */}
          <img
            src={photo.url}
            alt={photo.fileName}
            className="h-full w-full object-contain"
            style={{ maxHeight: '420px' }}
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

        {/* ── 右侧：详情面板 ── */}
        <div
          className="flex flex-1 flex-col"
          style={{ background: 'var(--paper)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              照片详情
            </span>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={handleClose}
              aria-label="关闭"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          {/* Separator */}
          <div style={{ height: '0.5px', background: 'var(--separator)', margin: '0 20px' }} />

          {/* 文件信息 */}
          <div className="px-5 pt-3 pb-4">
            <span
              className="text-xs"
              style={{ color: 'var(--ink-faded)' }}
            >
              {photo.fileName} · {formatFileSize(photo.size)}
            </span>
          </div>

          {/* Caption 区域 */}
          <div className="flex-1 px-5">
            {/* Label */}
            <div
              className="mb-1.5 text-2xs font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              说明
            </div>

            {/* Textarea — 30 字符上限 */}
            <textarea
              className="w-full resize-none rounded-md px-3 py-2.5 text-sm outline-none transition-colors duration-150"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink)',
                border: '1px solid var(--separator)',
                minHeight: '96px',
              }}
              placeholder="为这张照片添加说明..."
              maxLength={30}
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              /* 失焦时立即提交，确保用户切换方式不是翻页时也能保存 */
              onBlur={() => onCaptionChange(photo.id, captionDraft)}
            />

            {/* 字符计数：达到上限时变红 */}
            <div
              className="mt-1 text-right text-2xs"
              style={{
                color: captionDraft.length >= 30 ? 'var(--mark-red)' : 'var(--ink-ghost)',
              }}
            >
              {captionDraft.length} / 30
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center justify-between px-5 py-4">
            {/* 左侧：删除 */}
            <button
              className="text-sm font-medium transition-opacity duration-150 hover:opacity-70"
              style={{ color: 'var(--mark-red)' }}
              onClick={handleDelete}
            >
              删除照片
            </button>

            {/* 右侧：设为封面 + 完成 */}
            <div className="flex items-center gap-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
