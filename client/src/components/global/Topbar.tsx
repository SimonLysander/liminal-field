import { useTheme } from '@/hooks/use-theme';
import { Sun, Moon } from 'lucide-react';

/**
 * Topbar — Apple Liquid Glass 风格胶囊
 *
 * 右上角浮动，不占布局空间（pointer-events:none + auto）。
 * 参考 iOS 26 toolbar：backdrop-filter blur + 极浅白底 + 白色半透明边框。
 */
export default function Topbar() {
  const { theme, setTheme } = useTheme();

  return (
    <header
      className="pointer-events-none absolute right-3 top-3 z-10 flex items-center justify-end"
    >
      <button
        className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
        style={{
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          background: 'rgba(255,255,255,0.1)',
          border: '0.5px solid rgba(255,255,255,0.2)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          color: 'var(--ink-faded)',
        }}
        onClick={() =>
          setTheme(theme === 'daylight' ? 'midnight' : 'daylight')
        }
        aria-label="切换主题"
      >
        <Sun size={14} strokeWidth={1.5} className="theme-icon-light" />
        <Moon size={14} strokeWidth={1.5} className="theme-icon-dark" />
      </button>
    </header>
  );
}
