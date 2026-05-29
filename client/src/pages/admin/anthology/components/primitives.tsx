/**
 * Anthology 管理端共用原语
 *
 * 与 Notes ContentAdmin 右侧面板样式完全一致的小型 UI 原语，
 * 拆出到此文件避免各组件重复定义。
 */

/** 区块标签，与 Notes ContentAdmin 右侧面板的标签样式一致 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
      style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
    >
      {children}
    </div>
  );
}

/** 信息键值行 */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

/** 文字链接，与 Notes ContentAdmin 的 SideLink 样式完全一致 */
export function SideLink({
  label,
  primary,
  danger,
  onClick,
}: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** 空状态提示 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
        {message}
      </p>
    </div>
  );
}

/**
 * 版本状态标签 — Anthology 专用（不显示 commitHash，只显示已发布/未发布）
 *
 * 与 ContentVersionView 的 VersionStatusPill 视觉规格相同，
 * 但 Anthology 无 commitHash 概念，故单独定义。
 */
export function VersionStatusPill({ isPublished }: { isPublished: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-2xs font-medium"
      style={{
        background: isPublished ? 'var(--success-soft)' : 'var(--accent-soft)',
        color: isPublished ? 'var(--mark-green)' : 'var(--ink-faded)',
      }}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'currentColor' }} />
      {isPublished ? '已发布' : '未发布'}
    </span>
  );
}

/**
 * 文字按钮链接（非导航），用于标题行的"刷新"等低权重操作
 * 与 ContentVersionView 的 TextLink 完全一致
 */
export function TextLink({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : 'var(--ink-faded)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onMouseEnter={(e) => {
        if (!danger) e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = danger ? 'var(--mark-red)' : 'var(--ink-faded)';
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
