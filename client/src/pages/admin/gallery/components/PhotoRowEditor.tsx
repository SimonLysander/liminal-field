/*
 * PhotoRowEditor — 画廊编辑器主体:行式布局替代原 5 列网格 + Modal。
 *
 * 每一行 = 左 ⋮⋮ 拖柄 + 80×80 缩略图 + 右侧主区(caption + 副信息行)。
 * 设计要点:
 *   - caption 默认 inline textarea,没有"点开 modal 才能写"的摩擦
 *   - 拖柄独立(⋮⋮ 灰点),不跟点图/点文混淆 → 排序、看图、写字三件事各管各
 *   - 点缩略图 = 全屏 Lightbox 看大图(只看,不编辑)
 *   - 日期(📅 popover)、分辨率/大小(只读 tag)、EXIF(⋯ popover 装 4 个数字)
 *
 * 复用资源:dnd-kit(同 PhotoGrid)、EXIF_TEXT_FIELDS / Calendar / Popover。
 * 替代 PhotoGrid 和 PhotoEditModal,Modal 整个砍掉。
 */

import { useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import { GripVertical, X, Loader2, RotateCcw, CalendarDays, MoreHorizontal } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EXIF_TEXT_FIELDS } from './photo-exif-fields';
import type { LocalEditorPhoto, UploadProgress } from '../hooks/useGalleryEditor';
import { appleEase } from '@/lib/motion';

interface PhotoRowEditorProps {
  photos: LocalEditorPhoto[];
  uploadProgress: UploadProgress | null;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onCaptionChange: (photoId: string, caption: string) => void;
  onTagsChange: (photoId: string, tags: Record<string, string>) => void;
  onDelete: (photoId: string) => void;
  onUpload: (files: File[]) => void;
  onRetry: (photoId: string) => void;
}

const CAPTION_MAX = 30;

/** 字节 → KB/MB(只读 tag 用) */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 单张照片 sortable 行——所有 EXIF / caption inline,点图开大图 */
function SortableRow({
  photo,
  onCaptionChange,
  onTagsChange,
  onDelete,
  onRetry,
  onOpenLightbox,
}: {
  photo: LocalEditorPhoto;
  onCaptionChange: PhotoRowEditorProps['onCaptionChange'];
  onTagsChange: PhotoRowEditorProps['onTagsChange'];
  onDelete: PhotoRowEditorProps['onDelete'];
  onRetry: PhotoRowEditorProps['onRetry'];
  onOpenLightbox: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  // 本地 caption 草稿:每次按键不立刻回流父级,blur 才提交(同 PhotoEditModal 思路)
  const [captionDraft, setCaptionDraft] = useState(photo.caption ?? '');
  // 图像尺寸只读展示:首次加载后从 naturalWidth/Height 拿,失败留 null
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  // 校验错误:key → bool(超 30 字 / 数字格式不符)
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // photo 切换(reorder 后 props 变了)时同步草稿
  if (photo.caption !== undefined && captionDraft !== photo.caption && !document.activeElement?.matches(`[data-cap-id="${photo.id}"]`)) {
    setCaptionDraft(photo.caption);
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isUploading = !!photo.uploading;
  const isError = !!photo.error;

  /** EXIF 字段提交:沿用 LocationSelect 的 format + pattern 验证 */
  const handleExifChange = (
    key: string,
    rawInput: string,
    format: (v: string) => string,
  ) => {
    const next = { ...(photo.tags ?? {}) };
    const value = format(rawInput);
    if (value) next[key] = value;
    else delete next[key];
    onTagsChange(photo.id, next);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: false }));
  };

  const handleExifBlur = (key: string, rawInput: string, pattern: RegExp) => {
    if (rawInput && !pattern.test(rawInput)) {
      setErrors((e) => ({ ...e, [key]: true }));
    }
  };

  /** 日期 popover:存 YYYY-MM-DD 字符串(同 PhotoMetadataFields) */
  const shotAt = photo.tags?.shotAt;
  const shotAtDate = shotAt ? new Date(shotAt + 'T00:00:00') : undefined;
  const [calOpen, setCalOpen] = useState(false);

  const handleDateSelect = (day: Date | undefined) => {
    const next = { ...(photo.tags ?? {}) };
    if (day) {
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, '0');
      const dd = String(day.getDate()).padStart(2, '0');
      next.shotAt = `${yyyy}-${mm}-${dd}`;
    } else {
      delete next.shotAt;
    }
    onTagsChange(photo.id, next);
    setCalOpen(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex items-stretch gap-3 rounded-md py-2 transition-colors hover:bg-[color-mix(in_srgb,var(--shelf)_60%,transparent)]"
      {...attributes}
    >
      {/* 拖拽柄:只把 listeners 挂这里,整行就不会因点图/写字误触拖动 */}
      <button
        type="button"
        aria-label="拖拽重排"
        className="flex w-5 shrink-0 cursor-grab items-center justify-center text-[var(--ink-ghost)] opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...listeners}
      >
        <GripVertical size={14} strokeWidth={1.5} />
      </button>

      {/* 80×80 方缩略图,1:1 cover,点开 Lightbox */}
      <button
        type="button"
        aria-label="查看大图"
        onClick={onOpenLightbox}
        disabled={isUploading || isError}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md transition-opacity disabled:opacity-50"
        style={{
          background: 'var(--shelf)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {isUploading ? (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--ink-ghost)' }} />
          </div>
        ) : isError ? (
          <div className="flex h-full w-full items-center justify-center" title="上传失败,点击重试">
            <RotateCcw
              size={18}
              style={{ color: 'var(--mark-red)' }}
              onClick={(e) => { e.stopPropagation(); onRetry(photo.id); }}
            />
          </div>
        ) : (
          <img
            src={photo.url}
            alt={photo.caption || photo.fileName}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDim({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            className="h-full w-full object-cover"
          />
        )}
      </button>

      {/* 右侧主区:caption + 副信息行 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        {/* caption 输入(默认 inline,无边框,focus 出下沿 accent 线) */}
        <div className="relative">
          <textarea
            data-input-bare
            data-cap-id={photo.id}
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            onBlur={() => {
              if (captionDraft !== (photo.caption ?? '')) {
                onCaptionChange(photo.id, captionDraft);
              }
            }}
            placeholder="写一句…"
            maxLength={CAPTION_MAX}
            rows={1}
            className="w-full resize-none border-0 bg-transparent py-1 pr-12 text-sm outline-none shadow-none placeholder:text-[var(--ink-ghost)]"
            style={{
              color: 'var(--ink)',
              borderBottom: '1px solid transparent',
              minHeight: 28,
            }}
            onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid var(--accent)'; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderBottom = '1px solid transparent'; }}
          />
          {/* 字数计数:右侧绝对定位,达上限变红 */}
          <span
            className="pointer-events-none absolute right-1 top-1.5 text-[10px]"
            style={{
              color: captionDraft.length >= CAPTION_MAX ? 'var(--mark-red)' : 'var(--ink-ghost)',
            }}
          >
            {captionDraft.length}/{CAPTION_MAX}
          </span>
        </div>

        {/* 副信息行:日期 + 只读 tag(尺寸/大小) + EXIF popover */}
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-ghost)' }}>
          {/* 📅 日期 popover */}
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-[var(--shelf)] hover:text-[var(--ink-faded)]"
                style={{ color: shotAt ? 'var(--ink-faded)' : 'var(--ink-ghost)' }}
              >
                <CalendarDays size={11} strokeWidth={1.5} />
                <span>{shotAt ?? '选择日期'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={shotAtDate}
                onSelect={handleDateSelect}
                defaultMonth={shotAtDate}
              />
            </PopoverContent>
          </Popover>

          {/* 分隔点 */}
          <span>·</span>

          {/* 只读分辨率 */}
          <span>{dim ? `${dim.w}×${dim.h}` : '—'}</span>

          <span>·</span>

          {/* 只读大小 */}
          <span>{formatSize(photo.size)}</span>

          {/* 已填的 EXIF 摘要:有什么填什么,无的不显 */}
          {EXIF_TEXT_FIELDS.some((f) => photo.tags?.[f.key]) && (
            <>
              <span>·</span>
              <span className="truncate">
                {EXIF_TEXT_FIELDS
                  .filter((f) => photo.tags?.[f.key])
                  .map((f) => photo.tags![f.key])
                  .join(' · ')}
              </span>
            </>
          )}

          {/* ⋯ EXIF popover */}
          <div className="ml-auto">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="编辑拍摄参数"
                  className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--shelf)] hover:text-[var(--ink-faded)]"
                >
                  <MoreHorizontal size={12} strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[260px] p-3"
                align="end"
                style={{ background: 'var(--paper)' }}
              >
                <div
                  className="mb-2 text-2xs font-semibold uppercase"
                  style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
                >
                  拍摄参数
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {EXIF_TEXT_FIELDS.map(({ key, label, placeholder, prefix, suffix, pattern, parse, format }) => {
                    const rawValue = photo.tags?.[key] ? parse(photo.tags[key]) : '';
                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>{label}</label>
                        <div
                          className="flex h-7 items-center rounded-md border bg-[var(--shelf)] px-2 transition-colors focus-within:border-[var(--accent)]"
                          style={{ borderColor: errors[key] ? 'var(--mark-red)' : 'var(--separator)' }}
                        >
                          {prefix && (
                            <span className="shrink-0 text-xs" style={{ color: 'var(--ink-ghost)' }}>{prefix}</span>
                          )}
                          <input
                            data-input-bare
                            type="text"
                            value={rawValue}
                            onChange={(e) => handleExifChange(key, e.target.value, format)}
                            onBlur={(e) => handleExifBlur(key, e.target.value, pattern)}
                            placeholder={placeholder}
                            className="min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none outline-none placeholder:text-[var(--ink-ghost)]"
                            style={{ color: 'var(--ink)' }}
                          />
                          {suffix && (
                            <span className="shrink-0 text-xs" style={{ color: 'var(--ink-ghost)' }}>{suffix}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* 删除 ✕:行 hover 才显,克制 */}
      <button
        type="button"
        aria-label="删除照片"
        onClick={() => onDelete(photo.id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded text-[var(--ink-ghost)] opacity-0 transition-opacity hover:bg-[var(--shelf)] hover:text-[var(--mark-red)] group-hover:opacity-100"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** 全屏 Lightbox:看大图,只看不编辑 */
function Lightbox({
  photo,
  onClose,
}: {
  photo: LocalEditorPhoto | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {photo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: appleEase }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.86)' }}
        >
          <img
            src={photo.url}
            alt={photo.caption || photo.fileName}
            className="max-h-[92vh] max-w-[92vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PhotoRowEditor({
  photos,
  uploadProgress,
  onReorder,
  onCaptionChange,
  onTagsChange,
  onDelete,
  onUpload,
  onRetry,
}: PhotoRowEditorProps) {
  const uploading = uploadProgress !== null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Lightbox 当前查看的照片(null = 关)
  const [lightboxPhoto, setLightboxPhoto] = useState<LocalEditorPhoto | null>(null);

  // 拖拽 5px 触发,避免跟点拖柄的轻触冲突
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = photos.findIndex((p) => p.id === active.id);
    const toIndex = photos.findIndex((p) => p.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(fromIndex, toIndex);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) onUpload(Array.from(files));
    e.target.value = '';
  };

  return (
    <div>
      <div
        className="mb-2 text-2xs font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
      >
        照片 — 拖 ⋮⋮ 重排 · 点图看大图 · 边上 ⋯ 改拍摄参数
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {photos.map((photo) => (
              <SortableRow
                key={photo.id}
                photo={photo}
                onCaptionChange={onCaptionChange}
                onTagsChange={onTagsChange}
                onDelete={onDelete}
                onRetry={onRetry}
                onOpenLightbox={() => setLightboxPhoto(photo)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* 末尾上传槽:虚线纸条,像在本子里贴新照片 */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="mt-3 flex h-16 w-full items-center justify-center rounded-md text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--shelf)_60%,transparent)]"
        style={{
          border: '1.5px dashed var(--separator)',
          color: 'var(--ink-ghost)',
          opacity: uploading ? 0.4 : 1,
        }}
      >
        + 拖入或点击上传新照片
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <Lightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
    </div>
  );
}
