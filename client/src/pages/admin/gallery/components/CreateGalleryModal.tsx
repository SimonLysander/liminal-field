// src/pages/admin/gallery/components/CreateGalleryModal.tsx
//
// 画廊新建 Modal — 输入标题（必填）后创建帖子。
// 与 NodeFormModal 同级设计：motion 弹窗 + ThresholdOverlay-style 背景。

import { useState } from 'react';
import { motion } from 'motion/react';
import { smoothBounce } from '@/lib/motion';

interface CreateGalleryModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}

export function CreateGalleryModal({ open, onClose, onSubmit }: CreateGalleryModalProps) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(title.trim());
      setTitle('');
      onClose();
    } catch {
      setError('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="w-[420px] overflow-hidden"
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: smoothBounce }}
      >
        <div className="px-6 pb-1 pt-5">
          <h2
            className="font-semibold"
            style={{ color: 'var(--ink)', fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}
          >
            新建画廊动态
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6 pt-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
              标题
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border-none px-3 py-2 outline-none"
              style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)' }}
              placeholder="例如：春日散步"
              autoFocus
            />
          </label>

          {error && (
            <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="rounded-lg px-4 py-2 font-medium"
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-4 py-2 font-medium transition-opacity duration-150 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--text-sm)' }}
            >
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
