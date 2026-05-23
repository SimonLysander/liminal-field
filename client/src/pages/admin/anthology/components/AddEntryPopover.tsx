/**
 * AddEntryPopover — 添加条目就近浮层
 *
 * 替代原先全屏压暗 + blur 的全局 AddEntryModal:从「添加条目」按钮就近弹出(Notion 式)。
 * 复用设计系统标准件 <Input>/<Button>/<Popover>,不再 inline 复制按钮/输入框样式。
 * 交互:Enter 提交、Esc / 点浮层外关闭(均由 Radix Popover 内建)。
 * 错误用 banner.error 上报(与 CreateAnthologyPopover 保持一致)。
 */

import { useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { banner } from '@/components/ui/banner-api';

interface AddEntryPopoverProps {
  /** 就近锚点(触发器),通常是条目列表标头的「添加条目」按钮 */
  children: ReactNode;
  onSubmit: (title: string) => Promise<void>;
}

export function AddEntryPopover({ children, onSubmit }: AddEntryPopoverProps) {
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
      banner.error('添加失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* 按钮上方 + 向右展开(朝内容区开,不往边缘挤);w-72 比左栏新建稍宽 */}
      <PopoverContent side="top" align="start" sideOffset={6} className="w-72 p-2">
        <div className="mb-1.5 px-0.5 text-xs text-[var(--ink-faded)]">添加条目</div>
        <Input
          autoFocus
          placeholder="条目标题"
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
            {submitting ? '添加中…' : '添加'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
