import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/services/auth';
import { parseError } from '@/pages/admin/helpers';

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.login(password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(parseError(err, '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--paper)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-72 flex-col items-center gap-5"
      >
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

        {/* Password input */}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="管理密码"
          autoFocus
          className="h-9 w-full rounded-lg px-3 text-sm outline-none"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
          }}
        />

        {error && (
          <p
            className="-mt-2 w-full text-xs"
            style={{ color: 'var(--mark-red)' }}
          >
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !password}
          className="h-9 w-full text-sm font-medium transition-opacity disabled:opacity-40"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
