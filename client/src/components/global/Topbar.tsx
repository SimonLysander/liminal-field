import { useLocation } from 'react-router-dom';
import { useTheme } from '@/hooks/use-theme';
import { Sun, Moon } from 'lucide-react';

/**
 * Topbar — 右上角主题切换图标按钮(无胶囊)
 *
 * 无胶囊设计:不要玻璃底/描边/阴影,只留图标 + hover 淡底,跟全站图标按钮一致。
 *
 * 路径例外:
 *   /digest/:topicId/:reportId(公开报告页)由 report.tsx 自己在期刊内部
 *   渲染主题按钮(钉在期刊区域右上, 不在屏幕右上, 避免跟 Aurora panel 冲突)。
 */
export default function Topbar() {
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();

  // digest 报告页:主题按钮由 report.tsx 自渲染,这里隐藏避免重复 + 位置冲突
  if (/^\/digest\/[^/]+\/[^/]+/.test(pathname)) {
    return null;
  }

  return (
    <header
      className="pointer-events-none absolute right-3 top-3 z-10 flex items-center justify-end"
    >
      <button
        className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-[var(--hover-overlay)]"
        style={{ color: 'var(--ink-faded)' }}
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
