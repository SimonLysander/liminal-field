// src/pages/admin/gallery/components/CommitModal.tsx
//
// 画廊提交 Modal — 输入变更说明后提交版本。
// 使用统一 <Modal> 标准组件（居中面板，无毛玻璃）。

import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface CommitModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (changeNote: string) => Promise<void>;
}

export function CommitModal({ open, onClose, onSubmit }: CommitModalProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(note.trim() || '提交');
      setNote('');
      onClose();
    } catch {
      // commit 内部已 toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="提交版本"
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="commit-modal-form"
            disabled={submitting}
          >
            {submitting ? '提交中...' : '提交'}
          </Button>
        </>
      }
    >
      <form id="commit-modal-form" onSubmit={handleSubmit} className="flex flex-col gap-1.5">
        <label className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>
          变更说明
        </label>
        <Input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="描述本次修改的内容..."
          autoFocus
        />
      </form>
    </Modal>
  );
}
