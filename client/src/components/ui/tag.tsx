import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tag — 标签 / 胶囊(L2)
 *
 * 默认中性(shelf 底);传 color(如文字记号高亮色 / 草木色)时用其淡底 + 该色文字。
 * 收编散落的 inline 标签/胶囊。
 */
export function Tag({
  children,
  color,
  className,
}: {
  children: ReactNode;
  /** 可选:标签色(草木 / 文字记号呼应色),用其淡底 + 该色文字 */
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs', className)}
      style={
        color
          ? { background: `color-mix(in srgb, ${color} 15%, transparent)`, color }
          : { background: 'var(--shelf)', color: 'var(--ink-light)' }
      }
    >
      {children}
    </span>
  );
}
