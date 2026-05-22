/**
 * AddEntryModal — 添加条目弹窗
 *
 * 只需输入标题。日期等元数据在编辑器或管理面板里设置。
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import { smoothBounce } from '@/lib/motion';

interface AddEntryModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}

export function AddEntryModal({ open, onClose, onSubmit }: AddEntryModalProps) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setTitle('');
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(title.trim());
      onClose();
    } catch {
      banner.error('添加失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-[380px] rounded-2xl p-6"
        style={{
          background: 'var(--paper-light)',
          border: '1px solid var(--box-border)',
          boxShadow: 'var(--shadow-lg)',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: smoothBounce }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="mb-4 text-md font-semibold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          添加条目
        </h3>
        <input
          type="text"
          autoFocus
          placeholder="条目标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
          className="w-full rounded-lg px-3 py-2 text-base outline-none"
          style={{ background: 'var(--shelf)', color: 'var(--ink)', border: 'none' }}
        />
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            className="rounded-lg px-3.5 py-1.5 text-base transition-colors duration-150"
            style={{ color: 'var(--ink-faded)' }}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            取消
          </button>
          <button
            className="rounded-lg px-4 py-1.5 text-base font-medium transition-all duration-150"
            style={{
              background: title.trim() && !submitting ? 'var(--accent)' : 'var(--ink-ghost)',
              color: 'var(--accent-contrast)',
              cursor: title.trim() && !submitting ? 'pointer' : 'not-allowed',
            }}
            disabled={!title.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '添加中...' : '添加'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
