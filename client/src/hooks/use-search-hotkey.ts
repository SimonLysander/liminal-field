/**
 * useSearchHotkey -- ⌘K / Ctrl+K 切换全局搜索面板。
 *
 * Sidebar 和 IconRail 共用同一套快捷键逻辑，提取为 hook 避免重复。
 */
import { useEffect, useState } from 'react';

export function useSearchHotkey() {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  return { searchOpen, setSearchOpen };
}
