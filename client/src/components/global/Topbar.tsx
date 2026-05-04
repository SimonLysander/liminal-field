import { useTheme } from '@/hooks/use-theme';
import { Sun, Moon } from 'lucide-react';

export default function Topbar() {
  const { theme, setTheme } = useTheme();

  return (
    <header
      className="relative z-[1] flex shrink-0 items-center px-4"
      style={{ height: 48, borderBottom: '0.5px solid var(--separator)', background: 'var(--paper)' }}
    >
      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        {/* Theme toggle */}
        <button
          className="hover-shelf hover-ink flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200"
          style={{ color: 'var(--ink-faded)' }}
          onClick={() =>
            setTheme(theme === 'daylight' ? 'midnight' : 'daylight')
          }
          aria-label="Toggle theme"
        >
          <Sun size={15} strokeWidth={1.5} className="theme-icon-light" />
          <Moon size={15} strokeWidth={1.5} className="theme-icon-dark" />
        </button>
      </div>
    </header>
  );
}
