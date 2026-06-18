/**
 * useKeyboardShortcutsDialog — ⌘+/ 切换快捷键 cheatsheet 浮层状态。
 *
 * 单独文件（不与 KeyboardShortcutsDialog 组件同文件）：避免 react-refresh
 * "only-export-components" 报错（同文件混 component + hook export 不允许）。
 */
import { useEffect, useState } from 'react';

export function useKeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘+/ 或 Ctrl+/
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return { open, setOpen };
}
