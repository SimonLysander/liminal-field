/**
 * useSessionCountdown — 导入会话倒计时 hook。
 *
 * 基于 sessionStorage 存储的创建时间计算剩余秒数，
 * 刷新后继续倒数（不重新开始）。
 */
import { useEffect, useState } from 'react';

const SESSION_TTL_SECONDS = 30 * 60;
const STORAGE_KEY = 'batch-import-start';

/** 记录会话开始时间（batchParse 完成时调用） */
export function markSessionStart() {
  sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
}

/** 清除会话开始时间（取消/完成时调用） */
export function clearSessionStart() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function useSessionCountdown() {
  const [remaining, setRemaining] = useState(() => {
    const start = sessionStorage.getItem(STORAGE_KEY);
    if (!start) return SESSION_TTL_SECONDS;
    const elapsed = Math.floor((Date.now() - Number(start)) / 1000);
    return Math.max(0, SESSION_TTL_SECONDS - elapsed);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const expired = remaining <= 0;
  const urgent = remaining <= 120;

  return { display, expired, urgent, remaining };
}
