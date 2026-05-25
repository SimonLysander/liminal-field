import type { ReactNode } from 'react';

/**
 * EmptyState — 空状态(L3)
 *
 * 设计语言:空 = 待生长 → 一方待生长的纸艺土床(土壤 + 几株刚破土的小苗)+ 文字,大留白。
 * 全站统一:空花圃(刚冒头的小苗,"将生未生 = 待生长")。
 * 收编各页 lucide 线性图标(BookOpen 等)的空态。
 */
export function EmptyState({
  image = '/garden/empty-garden.webp',
  imageClassName = 'max-h-16 max-w-[120px]',
  title,
  description,
  action,
}: {
  /** 纸艺图(默认:空花圃土床+小苗,空状态专属) */
  image?: string;
  /** 图尺寸约束 class(默认克制小尺寸;主从布局大留白区可传更大) */
  imageClassName?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {/* 纸艺图:用 max 约束,任意图都不撑爆 */}
      <img
        src={image}
        alt=""
        className={`h-auto w-auto select-none ${imageClassName}`}
        draggable={false}
      />
      <div className="text-lg" style={{ color: 'var(--ink-faded)', letterSpacing: '-0.01em' }}>
        {title}
      </div>
      {description && (
        <div className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          {description}
        </div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
