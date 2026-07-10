import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CreateLearningChapterDialogProps {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (title: string) => void;
}

export function CreateLearningChapterDialog({
  open,
  submitting,
  onClose,
  onConfirm,
}: CreateLearningChapterDialogProps) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = title.trim();
    if (!normalized) {
      setError('请输入篇目名称');
      return;
    }
    onConfirm(normalized);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="sm:max-w-sm"
      title="新建篇目"
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="create-learning-chapter-form"
            disabled={submitting}
          >
            {submitting ? '创建中...' : '创建'}
          </Button>
        </>
      }
    >
      <form id="create-learning-chapter-form" className="space-y-3" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>
            篇目名称
          </span>
          <Input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError('');
            }}
            placeholder="例如：光圈和景深"
            aria-label="篇目名称"
          />
        </label>
        {error && (
          <p className="text-xs" style={{ color: 'var(--mark-red)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
