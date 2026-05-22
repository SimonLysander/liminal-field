import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * FieldError — 表单/字段错误提示(L3)
 *
 * 字号锁 text-xs、色 danger,统一收编全站散落的
 * `<p style={{ color: 'var(--mark-red)', fontSize: ? }}>` 错误提示(字号曾 xs/sm/base 不一)。
 * 无内容时不渲染。
 */
export function FieldError({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p className={cn('text-xs', className)} style={{ color: 'var(--danger)' }}>
      {children}
    </p>
  );
}
