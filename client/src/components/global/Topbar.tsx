import { useTheme } from '@/hooks/use-theme';
import { Sun, Moon } from 'lucide-react';

/**
 * Topbar — 胶囊式浮动工具栏
 *
 * 不再是全宽白条，改为右上角浮动的圆角胶囊，
 * 半透明背景 + backdrop-filter 毛玻璃，
 * 在 gallery 等沉浸式页面不破坏氛围。
 */
export default function Topbar() {
  const { theme, setTheme } = useTheme();

  return (
    <header
      className="pointer-events-none relative z-[1] flex shrink-0 items-center justify-end px-4"
      style={{ height: 48 }}
    >
      {/* 胶囊容器 */}
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-full px-1 transition-all duration-200"
        style={{
          background: 'color-mix(in srgb, var(--shelf) 80%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '0.5px solid var(--separator)',
        }}
      >
        <button
          className="hover-shelf hover-ink flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200"
          style={{ color: 'var(--ink-faded)' }}
          onClick={() =>
            setTheme(theme === 'daylight' ? 'midnight' : 'daylight')
          }
          aria-label="切换主题"
        >
          <Sun size={14} strokeWidth={1.5} className="theme-icon-light" />
          <Moon size={14} strokeWidth={1.5} className="theme-icon-dark" />
        </button>
      </div>
    </header>
  );
}
