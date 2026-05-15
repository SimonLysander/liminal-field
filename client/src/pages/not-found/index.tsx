import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="enter-rise enter-delay-1 flex flex-col items-center gap-2">
        <span
          className="text-3xl font-light"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '-0.02em' }}
        >
          404
        </span>
        <span className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          页面不存在
        </span>
        <Link
          to="/"
          className="mt-3 text-xs transition-colors duration-150"
          style={{ color: 'var(--ink-ghost)' }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-ghost)'; }}
        >
          回到首页 →
        </Link>
      </div>
    </div>
  );
}
