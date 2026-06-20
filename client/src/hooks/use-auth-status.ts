/**
 * useAuthStatus — 公开端组件用，反映"当前用户是否已登录"。
 *
 * 项目内 isAuthenticated 是 App.tsx 模块级变量，未导出到 hook。
 * 公开页面（如 /digest/:topicId/:reportId）要"未登录显示按钮、已登录
 * 显示完整 UI"时需要响应式登录态。这个 hook 调 authApi.check() 拿状态，
 * 缓存到组件 state，防 loading 期间闪烁。
 *
 * 注：跟 App.tsx 的 authChecked 缓存不互通（公开页面初次访问可能没经过
 * AuthGuard），各自 check。authApi.check 自身是只读 GET，重复调用安全。
 */
import { useEffect, useState } from 'react';
import { authApi } from '@/services/auth';

export type AuthStatusValue = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthStatus {
  status: AuthStatusValue;
}

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatusValue>('checking');

  useEffect(() => {
    let cancelled = false;
    authApi
      .check()
      .then((r) => {
        if (!cancelled) {
          setStatus(r.authenticated ? 'authenticated' : 'unauthenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status };
}
