import { cn } from '@/lib/utils';

/**
 * Dot — 状态点(L2 基础件)
 *
 * 颜色按语义:成功(绿)/ 危险(红)/ 进行中(主题色 + pulse)/ 中性(墨·幽)。
 * 收编全站散落的 inline `borderRadius:999px` 小圆点。
 */
export type DotVariant = 'success' | 'danger' | 'accent' | 'neutral';

const DOT_COLOR: Record<DotVariant, string> = {
  success: 'var(--success)',
  danger: 'var(--danger)',
  accent: 'var(--accent)', // 进行中/激活,配 pulse
  neutral: 'var(--ink-ghost)',
};

export function Dot({
  variant = 'neutral',
  pulse = false,
  className,
}: {
  variant?: DotVariant;
  /** 进行中:配 accent + pulse 表示"正在进行/激活" */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-block size-[7px] shrink-0 rounded-full', className)}
      style={{
        background: DOT_COLOR[variant],
        // pulse keyframe 定义在 index.css
        animation: pulse ? 'pulse 1.2s ease-in-out infinite' : undefined,
      }}
    />
  );
}
