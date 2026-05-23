// src/pages/admin/gallery/components/CreateGalleryPopover.tsx
//
// 新建画廊动态就近浮层 — 替代原全屏压暗 + blur 的全局 Modal。
// 从「新建」按钮锚定弹出(Notion 式),复用 <Popover>/<Input>/<Button>/<FieldError> 标准件。
// 校验/提交失败用内联 <FieldError>;Enter 提交、Esc / 点外关闭(Radix 内建)。

import { useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';

interface CreateGalleryPopoverProps {
  /** 就近锚点(触发器),通常是底部栏的「新建」按钮 */
  children: ReactNode;
  onSubmit: (title: string) => Promise<void>;
}

export function CreateGalleryPopover({ children, onSubmit }: CreateGalleryPopoverProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 每次打开浮层时重置输入与错误,避免残留上次内容
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setTitle('');
      setError('');
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(title.trim());
      setOpen(false);
    } catch {
      setError('创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* 按钮在左栏底部:向上 + 向右展开(左侧触发朝屏幕中心开,不往左边缘挤) */}
      <PopoverContent side="top" align="start" sideOffset={6} className="p-3">
        <div className="mb-1.5 px-0.5 text-xs text-[var(--ink-faded)]">新建画廊动态</div>
        <Input
          autoFocus
          placeholder="例如：春日散步"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
        />
        <FieldError className="mt-1 px-0.5">{error}</FieldError>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '创建中…' : '创建'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
