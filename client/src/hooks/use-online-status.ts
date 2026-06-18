/**
 * useOnlineStatus — 监听 navigator.onLine，online/offline 事件
 *
 * 用于保存状态指示：离线时草稿只能存 localStorage，server 同步要等联网。
 * SSR 安全：初始值默认 true（多数浏览器联网态），首次 effect 校准。
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
