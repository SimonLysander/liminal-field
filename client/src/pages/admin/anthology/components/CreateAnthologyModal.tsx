/**
 * CreateAnthologyModal — 新建文集弹窗
 *
 * 单输入框弹窗，Enter / 点击"创建"提交，Escape / 点击遮罩关闭。
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import { smoothBounce } from '@/lib/motion';

interface CreateAnthologyModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}

export function CreateAnthologyModal({ open, onClose, onSubmit }: CreateAnthologyModalProps) {
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
      banner.error('创建失败，请重试');
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
          className="mb-4 font-semibold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-md)', letterSpacing: '-0.01em' }}
        >
          新建文集
        </h3>
        <input
          type="text"
          autoFocus
          placeholder="文集标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
          className="w-full rounded-lg px-3 py-2 outline-none"
          style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-base)', border: 'none' }}
        />
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            className="rounded-lg px-3.5 py-1.5 transition-colors duration-150"
            style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            取消
          </button>
          <button
            className="rounded-lg px-4 py-1.5 font-medium transition-all duration-150"
            style={{
              background: title.trim() && !submitting ? 'var(--accent)' : 'var(--ink-ghost)',
              color: 'var(--accent-contrast)',
              fontSize: 'var(--text-base)',
              cursor: title.trim() && !submitting ? 'pointer' : 'not-allowed',
            }}
            disabled={!title.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
