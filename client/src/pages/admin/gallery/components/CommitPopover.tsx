// src/pages/admin/gallery/components/CommitPopover.tsx
//
// 画廊提交版本就近浮层 — 从「提交」按钮锚定弹出(Notion 式),替代原居中 Modal。
// 输入变更说明 → onSubmit 触发 Git commit。复用 <Popover>/<Input>/<Button> 标准件。
// Enter 提交、Esc / 点外关闭(Radix 内建)。

import { useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface CommitPopoverProps {
  /** 就近锚点(触发器),即「提交」按钮 */
  children: ReactNode;
  onSubmit: (changeNote: string) => Promise<void>;
}

export function CommitPopover({ children, onSubmit }: CommitPopoverProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开浮层时清空输入,避免残留上次内容
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setNote('');
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(note.trim() || '提交');
      setOpen(false);
    } catch {
      // commit 失败由内部 toast 提示
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-3">
        <div className="mb-0.5 text-md font-semibold" style={{ color: 'var(--ink)' }}>提交版本</div>
        <p className="mb-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>提交为新的正式版本</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>变更说明</span>
          <Input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            placeholder="描述本次修改的内容..."
            autoFocus
          />
        </label>
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="primary" size="sm" type="button" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? '提交中…' : '提交'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
