import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/services/auth';
import { resetAuth } from '@/App';
import { parseError } from '@/pages/admin/helpers';
import { useConfirm } from '@/contexts/ConfirmContext';

const DEVICE_TOKEN_KEY = 'liminal_device_token';

export default function LoginPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [hasDeviceToken, setHasDeviceToken] = useState(
    () => !!localStorage.getItem(DEVICE_TOKEN_KEY),
  );

  const enterAdmin = () => {
    resetAuth();
    navigate('/admin', { replace: true });
  };

  // 密码登录 → 成功后弹信任弹框
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.login(password);

      // 没有设备 token 时，询问是否信任
      if (!localStorage.getItem(DEVICE_TOKEN_KEY)) {
        const trust = await confirm({
          title: '信任此设备？',
          message: '信任后下次可免密登录。仅在个人设备上使用。',
          confirmLabel: '信任',
          cancelLabel: '跳过',
        });
        if (trust) {
          const { deviceToken } = await authApi.trustDevice();
          localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
        }
      }

      enterAdmin();
    } catch (err) {
      setError(parseError(err, '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  // 设备 token 免密登录
  const handleDeviceLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const token = localStorage.getItem(DEVICE_TOKEN_KEY)!;
      await authApi.deviceLogin(token);
      enterAdmin();
    } catch {
      // token 失效，清除
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      setHasDeviceToken(false);
      setError('设备信任已失效，请重新输入密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--paper)' }}
    >
      <div className="flex w-72 flex-col items-center gap-5">
        {/* Logo */}
        <div
          className="flex h-9 w-9 items-center justify-center text-xs font-semibold"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          L
        </div>

        <h1
          className="text-base font-medium"
          style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          Liminal Field
        </h1>

        {/* 设备登录按钮（有 token 时显示） */}
        {hasDeviceToken && (
          <button
            type="button"
            onClick={() => void handleDeviceLogin()}
            disabled={loading}
            className="h-9 w-full text-sm font-medium transition-opacity disabled:opacity-40"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {loading ? '登录中...' : '设备登录'}
          </button>
        )}

        {/* 分隔线（有设备 token 时显示） */}
        {hasDeviceToken && (
          <div className="flex w-full items-center gap-3">
            <div className="flex-1" style={{ borderTop: '0.5px solid var(--separator)' }} />
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              或输入密码
            </span>
            <div className="flex-1" style={{ borderTop: '0.5px solid var(--separator)' }} />
          </div>
        )}

        {/* 密码登录 */}
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="管理密码"
            autoFocus={!hasDeviceToken}
            className="h-9 w-full rounded-lg px-3 text-sm outline-none"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
            }}
          />

          {error && (
            <p className="text-xs" style={{ color: 'var(--mark-red)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="h-9 w-full text-sm font-medium transition-opacity disabled:opacity-40"
            style={{
              background: hasDeviceToken ? 'var(--shelf)' : 'var(--ink)',
              color: hasDeviceToken ? 'var(--ink-faded)' : 'var(--paper)',
              borderRadius: 'var(--radius-md)',
              border: hasDeviceToken ? '1px solid var(--separator)' : 'none',
            }}
          >
            {loading ? '登录中...' : '密码登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
