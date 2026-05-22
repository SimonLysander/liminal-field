import type { ReactNode } from 'react';

/**
 * EmptyState — 空状态(L3)
 *
 * 设计语言:空 = 待生长 → 一株纸花圃同源的纸艺植物 + 文字,大留白。
 * 全站统一同一株(不每页换花)。素材现用 garden webp 占位,待 GPT 生成空状态专属素材替换。
 * 收编各页 lucide 线性图标(BookOpen 等)的空态。
 */
export function EmptyState({
  image = '/garden/dandelion-4.webp',
  title,
  description,
  action,
}: {
  /** 纸艺植物图(默认蒲公英占位) */
  image?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <img src={image} alt="" className="h-14 w-auto select-none" draggable={false} />
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
