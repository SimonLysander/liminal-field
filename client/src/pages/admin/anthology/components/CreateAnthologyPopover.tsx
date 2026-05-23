/**
 * CreateAnthologyPopover — 新建文集就近浮层
 *
 * 替代原先全屏压暗 + blur 的全局 Modal:从「新建」按钮就近弹出(Notion 式)。
 * 复用设计系统标准件 <Input>/<Button>/<Popover>,不再 inline 复制按钮/输入框样式。
 * 交互:Enter 提交、Esc / 点浮层外关闭(均由 Radix Popover 内建)。
 */

import { useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { banner } from '@/components/ui/banner-api';

interface CreateAnthologyPopoverProps {
  /** 就近锚点(触发器),通常是底部栏的「新建」按钮 */
  children: ReactNode;
  onSubmit: (title: string) => Promise<void>;
}

export function CreateAnthologyPopover({ children, onSubmit }: CreateAnthologyPopoverProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 每次打开浮层时清空输入,避免残留上次内容
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setTitle('');
  };

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(title.trim());
      setOpen(false);
    } catch {
      banner.error('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* 锚定按钮上方右对齐:按钮在左栏底部,浮层向上展开更自然 */}
      <PopoverContent side="top" align="end" sideOffset={6} className="w-60 p-2">
        <div className="mb-1.5 px-0.5 text-xs text-[var(--ink-faded)]">新建文集</div>
        <Input
          autoFocus
          placeholder="文集标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
        />
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!title.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '创建中…' : '创建'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
