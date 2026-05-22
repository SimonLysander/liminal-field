import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/**
 * Modal — 统一弹窗(L3)
 *
 * 收编全站 11 个自写 `fixed inset-0 + backdropFilter` 的 Modal:遮罩已是纸墨纯暗化(无 blur,
 * 见 dialog.tsx 的 `bg-black/40`)、卡片走 shadcn DialogContent(圆角 + 阴影 + Esc/点遮罩关 + 关闭按钮)。
 *
 * 用法:
 *   <Modal open={open} onClose={() => setOpen(false)} title="删除?" footer={<>...按钮</>}>
 *     正文
 *   </Modal>
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className={className}>
        {title && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
