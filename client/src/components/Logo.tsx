/*
 * Logo — Lux Stirring 花体 wordmark
 *
 * 字体：Alex Brush — 干净自然的手写感，呼应箴言"纸墨"的气质。
 * "Lux" ink 深 / "stirring" ink-light 淡，浓淡体现对偶。
 *
 * variant="full": 完整 wordmark（登录页、侧边栏）
 * variant="mark": 花体 "L"（IconRail 等窄空间）
 */

const LOGO_FONT = '"Alex Brush", cursive';

interface LogoProps {
  variant?: 'full' | 'mark';
  size?: number;
  className?: string;
}

export function Logo({ variant = 'full', size = 20, className }: LogoProps) {
  if (variant === 'mark') {
    return (
      <span
        className={className}
        style={{
          fontFamily: LOGO_FONT,
          fontSize: `${size}px`,
          lineHeight: 1,
          color: 'var(--ink)',
          userSelect: 'none',
        }}
        aria-label="Lux Stirring"
      >
        L
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        fontFamily: LOGO_FONT,
        fontSize: `${size}px`,
        lineHeight: 1.3,
      }}
      aria-label="Lux Stirring"
    >
      <span style={{ color: 'var(--ink)' }}>Lux</span>
      {' '}
      <span style={{ color: 'var(--ink-light)' }}>stirring</span>
    </span>
  );
}
