// src/pages/admin/gallery/components/PostDetail.tsx

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { GalleryPostDetail } from '@/services/workspace';

/*
 * PostDetail — 画廊动态详情/原地编辑
 *
 * 查看态：只读展示照片网格 + 描述 + 操作链接
 * 编辑态：照片可删除/新增，描述变为 textarea，底部保存/取消
 *
 * 照片网格：缩略图 radius-md (8px)，第一张标记"封面"。
 * 操作链接：纯文本样式（编辑/发布/删除），和笔记管理的 TextLink 风格一致。
 */

export function PostDetail({
  post,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onPublish,
  onUnpublish,
  onUploadPhoto,
  onDeletePhoto,
}: {
  post: GalleryPostDetail;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (title: string, description: string) => void;
  onDelete: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onUploadPhoto: (file: File) => void;
  onDeletePhoto: (photoId: string) => void;
}) {
  const [editTitle, setEditTitle] = useState(post.title);
  const [editDesc, setEditDesc] = useState(post.description);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 进入编辑态时同步字段 */
  const handleStartEdit = () => {
    setEditTitle(post.title);
    setEditDesc(post.description);
    onEdit();
  };

  const handleSave = () => {
    onSave(editTitle, editDesc);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => onUploadPhoto(file));
    }
    e.target.value = '';
  };

  return (
    <div className="flex-1 overflow-y-auto px-10 py-9">
      {/* Title */}
      {editing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="mb-1 w-full border-none bg-transparent font-bold outline-none"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-3xl)', letterSpacing: '-0.02em' }}
        />
      ) : (
        <h2
          className="mb-1 font-bold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-3xl)', letterSpacing: '-0.02em' }}
        >
          {post.title}
        </h2>
      )}
      <div className="mb-5" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
        {new Date(post.createdAt).toLocaleDateString('zh-CN')} · {post.status === 'published' ? '已发布' : '草稿'}
      </div>

      {/* Photos section */}
      <div className="mb-5">
        <div
          className="mb-2 font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.04em' }}
        >
          照片
        </div>
        <div className="flex flex-wrap gap-2">
          {post.photos.map((photo, i) => (
            <div
              key={photo.id}
              className="group relative overflow-hidden"
              style={{ width: 130, height: 98, borderRadius: 'var(--radius-md)' }}
            >
              <img
                src={photo.url}
                alt={photo.fileName}
                className="h-full w-full object-cover"
              />
              {i === 0 && (
                <span
                  className="absolute left-1 top-1 rounded px-1.5 py-px"
                  style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.5625rem' }}
                >
                  封面
                </span>
              )}
              {editing && (
                <button
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
                  onClick={() => onDeletePhoto(photo.id)}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </div>
          ))}

          {/* Upload button (always visible in edit mode, also visible if no photos) */}
          {(editing || post.photos.length === 0) && (
            <button
              className="flex items-center justify-center"
              style={{
                width: 88,
                height: 98,
                borderRadius: 'var(--radius-md)',
                border: '1.5px dashed var(--separator)',
                color: 'var(--ink-ghost)',
                fontSize: 'var(--text-lg)',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              +
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* Description section */}
      <div className="mb-5">
        <div
          className="mb-2 font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.04em' }}
        >
          描述
        </div>
        {editing ? (
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className="min-h-[100px] w-full resize-y rounded-[10px] border-none px-3.5 py-3 outline-none"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink-light)',
              fontSize: 'var(--text-base)',
              lineHeight: 1.7,
              fontFamily: 'var(--font-sans)',
            }}
          />
        ) : (
          <div
            className="rounded-[10px] px-3.5 py-3 leading-[1.7]"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink-light)',
              fontSize: 'var(--text-base)',
            }}
          >
            {post.description || '暂无描述'}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        {editing ? (
          <>
            <TextAction label="保存" primary onClick={handleSave} />
            <TextAction label="取消" onClick={onCancelEdit} />
          </>
        ) : (
          <>
            <TextAction label="编辑" primary onClick={handleStartEdit} />
            {post.status === 'published' ? (
              <TextAction label="取消发布" onClick={onUnpublish} />
            ) : (
              <TextAction label="发布" onClick={onPublish} />
            )}
            <TextAction label="删除" danger onClick={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

function TextAction({ label, primary, danger, onClick }: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 500 : 400,
        fontSize: 'var(--text-xs)',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
