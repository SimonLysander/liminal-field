/**
 * useSessionCountdown — 导入会话倒计时 hook。
 *
 * 从页面挂载起倒数 duration 秒（默认 30 分钟 = 1800s），
 * 返回格式化文本和是否过期标志。
 */
import { useEffect, useState } from 'react';

const SESSION_TTL_SECONDS = 30 * 60;

export function useSessionCountdown(duration = SESSION_TTL_SECONDS) {
  const [remaining, setRemaining] = useState(duration);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const expired = remaining <= 0;
  const urgent = remaining <= 120; // 最后 2 分钟变红

  return { display, expired, urgent, remaining };
}
