// src/pages/admin/gallery/components/PhotoGrid.tsx

/*
 * PhotoGrid — 5 列可拖拽排序照片缩略图网格
 *
 * 使用 dnd-kit 实现拖拽重排：
 * - PointerSensor 要求至少移动 5px 才激活拖拽，避免与点击冲突
 * - SortableContext + rectSortingStrategy 自动计算网格位置
 *
 * 每张照片是独立的 SortablePhoto 子组件，持有自己的 useSortable 状态。
 * 末尾的 "+" 按钮触发隐藏的 <input type="file" /> 来批量选择图片。
 */

import { useRef } from 'react';
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
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import type { GalleryPhoto } from '@/services/workspace';

// ---------- Props ----------

interface PhotoGridProps {
  photos: GalleryPhoto[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onPhotoClick: (index: number) => void;
  onDelete: (photoId: string) => void;
  onUpload: (files: File[]) => void;
}

// ---------- SortablePhoto ----------

/*
 * SortablePhoto — 单张可拖拽照片
 *
 * 用 photo.id 作为 dnd-kit 唯一标识符。
 * 当 isDragging 时降低透明度以给用户拖拽中的视觉反馈。
 * caption badge 绝对定位在右下角。
 */
function SortablePhoto({
  photo,
  index,
  onClick,
  onDelete,
}: {
  photo: GalleryPhoto;
  index: number;
  onClick: (index: number) => void;
  onDelete: (photoId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative aspect-square overflow-hidden rounded-md"
      onClick={() => onClick(index)}
    >
      <img
        src={photo.url}
        alt={photo.fileName}
        className="h-full w-full object-cover"
        draggable={false}
      />

      {/* 删除按钮 — hover 时右上角出现（Apple Photos 风格） */}
      <button
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
        onClick={(e) => { e.stopPropagation(); onDelete(photo.id); }}
        aria-label="删除照片"
      >
        <X size={11} strokeWidth={2.5} />
      </button>

      {/* 说明 badge — 有 caption 时显示 */}
      {photo.caption && (
        <span
          className="text-2xs absolute bottom-1 right-1 rounded px-1 py-px leading-tight"
          style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
        >
          说明
        </span>
      )}
    </div>
  );
}

// ---------- PhotoGrid ----------

export function PhotoGrid({ photos, onReorder, onPhotoClick, onDelete, onUpload }: PhotoGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 5px 移动距离才激活拖拽，防止干扰点击事件 */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  /* dnd-kit 返回 active/over 的 id，需要转换成 index 再调用 onReorder */
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
    if (files && files.length > 0) {
      onUpload(Array.from(files));
    }
    /* 清空 value 以允许重复选同一文件 */
    e.target.value = '';
  };

  return (
    <div>
      {/* Section header */}
      <div
        className="mb-2 text-2xs font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
      >
        照片 — 拖拽调整顺序 · 点击编辑
      </div>

      {/* 5-column sortable grid */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-5 gap-1.5">
            {photos.map((photo, index) => (
              <SortablePhoto
                key={photo.id}
                photo={photo}
                index={index}
                onClick={onPhotoClick}
                onDelete={onDelete}
              />
            ))}

            {/* Upload button — 始终显示在网格末尾 */}
            <button
              className="flex aspect-square items-center justify-center rounded-md transition-colors duration-150"
              style={{
                border: '1.5px dashed var(--separator)',
                color: 'var(--ink-ghost)',
                fontSize: 'var(--text-lg)',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              +
            </button>
          </div>
        </SortableContext>
      </DndContext>

      {/* 隐藏的文件选择器，接受多张图片 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
