import { useTheme } from '@/hooks/use-theme';
import { Sun, Moon } from 'lucide-react';

/**
 * Topbar — 右上角浮动胶囊按钮
 *
 * 配色跟随设计系统（--shelf / --separator / --ink-faded），
 * 和 Sidebar 视觉一致。
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
          background: 'var(--sidebar-bg)',
          border: '0.5px solid var(--separator)',
          boxShadow: 'var(--shadow-sm)',
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
