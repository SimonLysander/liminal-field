/*
 * SettingsUI — Settings 页面共享原子组件。
 * 所有 tab 面板复用同一套卡片、标题、按钮、表单样式。
 */

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// ── 加载占位 ───────────────────────────────────────────

/** 区块加载骨架：标题 + 3 行占位条 */
export function SectionSkeleton({ title }: { title?: string }) {
  return (
    <div
      className="animate-pulse p-6"
      style={{
        background: 'var(--paper-dark)',
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {title && (
        <div
          className="mb-4 text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--ink-ghost)' }}
        >
          {title}
        </div>
      )}
      <div className="space-y-3">
        <div className="h-3 w-3/4 rounded" style={{ background: 'var(--shelf)' }} />
        <div className="h-3 w-1/2 rounded" style={{ background: 'var(--shelf)' }} />
        <div className="h-3 w-2/3 rounded" style={{ background: 'var(--shelf)' }} />
      </div>
    </div>
  );
}

// ── 布局 ────────────────────────────────────────────────

export function PageHeader({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mb-6 text-xl font-semibold"
      style={{ color: 'var(--ink)' }}
    >
      {children}
    </h1>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="p-6"
      style={{
        background: 'var(--paper-dark)',
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--separator)',
      }}
    >
      <div
        className="mb-4 text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {title}
      </div>
      {description && (
        <p
          className="mb-4 text-xs"
          style={{ color: 'var(--ink-ghost)' }}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * EditableSection — 只读/编辑双模式区块。
 *
 * 默认只读展示 viewContent + 右上角"编辑"按钮。
 * 进入编辑后展示 editContent + 底部"保存 / 放弃修改"。
 */
export function EditableSection({
  title,
  description,
  editing,
  onEdit,
  onSave,
  onReset,
  saving,
  canSave = true,
  viewContent,
  editContent,
}: {
  title: string;
  description?: string;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onReset: () => void;
  saving?: boolean;
  canSave?: boolean;
  viewContent: React.ReactNode;
  editContent: React.ReactNode;
}) {
  return (
    <div
      className="p-6"
      style={{
        background: 'var(--paper-dark)',
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--separator)',
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--ink-ghost)' }}
        >
          {title}
        </div>
        {!editing && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100"
            style={{
              color: 'var(--ink-faded)',
              background: 'var(--shelf)',
            }}
          >
            编辑
          </button>
        )}
      </div>
      {description && (
        <p className="mb-4 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {description}
        </p>
      )}

      {editing ? (
        <>
          {editContent}
          <div className="mt-4 flex gap-2">
            <PrimaryButton onClick={onSave} disabled={saving || !canSave}>
              {saving ? '保存中...' : '保存'}
            </PrimaryButton>
            <SecondaryButton onClick={onReset} disabled={saving}>
              放弃修改
            </SecondaryButton>
          </div>
        </>
      ) : (
        viewContent
      )}
    </div>
  );
}

// ── 表单 ────────────────────────────────────────────────

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium" style={{ color: 'var(--ink-faded)' }}>
      {children}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && visible ? 'text' : type;

  return (
    <div className="relative mt-1">
      <input
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-9 w-full rounded-lg px-3 text-sm outline-none disabled:opacity-50"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink)',
          border: '1px solid var(--separator)',
          paddingRight: isPassword ? '2.5rem' : undefined,
        }}
      />
      {isPassword && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
          style={{ color: 'var(--ink-ghost)' }}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
    </div>
  );
}

/** 下拉选择 */
export function SelectInput({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="mt-1 h-9 w-full rounded-lg px-3 text-sm outline-none disabled:opacity-50"
      style={{
        background: 'var(--shelf)',
        color: 'var(--ink)',
        border: '1px solid var(--separator)',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Cron 频率下拉 */
const CRON_PRESETS = [
  { value: '0 * * * *', label: '每小时' },
  { value: '0 */3 * * *', label: '每 3 小时' },
  { value: '0 */6 * * *', label: '每 6 小时' },
  { value: '0 */12 * * *', label: '每 12 小时' },
  { value: '0 0 * * *', label: '每天 0:00' },
  { value: '0 3 * * *', label: '每天 3:00' },
  { value: '0 3 * * 1', label: '每周一 3:00' },
] as const;

export function CronSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isPreset = CRON_PRESETS.some((p) => p.value === value);
  return (
    <div className="mt-1 space-y-2">
      <select
        value={isPreset ? value : '__custom__'}
        onChange={(e) => {
          if (e.target.value !== '__custom__') onChange(e.target.value);
        }}
        className="h-9 w-full rounded-lg px-3 text-sm outline-none"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink)',
          border: '1px solid var(--separator)',
        }}
      >
        {CRON_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">自定义...</option>
      </select>
      {!isPreset && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0 3 * * *"
          className="h-9 w-full rounded-lg px-3 text-sm outline-none"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
          }}
        />
      )}
    </div>
  );
}

/** 阿里云 OSS Region 下拉 */
const OSS_REGIONS = [
  { value: 'oss-cn-hangzhou', label: '华东 1（杭州）' },
  { value: 'oss-cn-shanghai', label: '华东 2（上海）' },
  { value: 'oss-cn-nanjing', label: '华东 5（南京）' },
  { value: 'oss-cn-beijing', label: '华北 2（北京）' },
  { value: 'oss-cn-zhangjiakou', label: '华北 3（张家口）' },
  { value: 'oss-cn-shenzhen', label: '华南 1（深圳）' },
  { value: 'oss-cn-guangzhou', label: '华南 3（广州）' },
  { value: 'oss-cn-chengdu', label: '西南 1（成都）' },
  { value: 'oss-cn-hongkong', label: '中国香港' },
  { value: 'oss-ap-southeast-1', label: '新加坡' },
  { value: 'oss-us-west-1', label: '美国（硅谷）' },
] as const;

export function OssRegionSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isKnown = OSS_REGIONS.some((r) => r.value === value);
  return (
    <div className="mt-1 space-y-2">
      <select
        value={isKnown ? value : '__custom__'}
        onChange={(e) => {
          if (e.target.value !== '__custom__') onChange(e.target.value);
        }}
        className="h-9 w-full rounded-lg px-3 text-sm outline-none"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink)',
          border: '1px solid var(--separator)',
        }}
      >
        {OSS_REGIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
        <option value="__custom__">其他...</option>
      </select>
      {!isKnown && value && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="oss-cn-beijing"
          className="h-9 w-full rounded-lg px-3 text-sm outline-none"
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
          }}
        />
      )}
    </div>
  );
}

// ── 状态展示 ────────────────────────────────────────────

export function StatusRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {label}
      </span>
      <span
        className="text-right text-sm"
        style={{ color: highlight ? 'var(--mark-red)' : 'var(--ink-faded)' }}
      >
        {value}
      </span>
    </div>
  );
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: connected ? 'var(--mark-green)' : 'var(--mark-red)',
      }}
    />
  );
}

export function Hint({
  children,
  warning,
}: {
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <p
      className="text-sm"
      style={{ color: warning ? 'var(--mark-red)' : 'var(--ink-ghost)' }}
    >
      {children}
    </p>
  );
}

export function Divider() {
  return (
    <div
      className="my-3"
      style={{ borderTop: '0.5px solid var(--separator)' }}
    />
  );
}

export function ValidationBanner({
  result,
}: {
  result: { valid: boolean; message: string };
}) {
  const ok = result.valid;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{
        background: ok
          ? 'color-mix(in srgb, var(--mark-green) 12%, transparent)'
          : 'color-mix(in srgb, var(--mark-red) 12%, transparent)',
        color: ok ? 'var(--mark-green)' : 'var(--mark-red)',
        border: `1px solid ${
          ok
            ? 'color-mix(in srgb, var(--mark-green) 25%, transparent)'
            : 'color-mix(in srgb, var(--mark-red) 25%, transparent)'
        }`,
      }}
    >
      {ok ? '\u2713 ' : '\u2717 '}
      {result.message}
    </div>
  );
}

// ── 按钮 ────────────────────────────────────────────────

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 shrink-0 rounded-lg px-4 text-sm font-medium transition-opacity duration-150 disabled:opacity-40"
      style={{ background: 'var(--ink)', color: 'var(--paper)' }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 shrink-0 rounded-lg px-4 text-sm font-medium transition-opacity duration-150 disabled:opacity-40"
      style={{
        background: 'var(--shelf)',
        color: 'var(--ink-faded)',
        border: '1px solid var(--separator)',
      }}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 shrink-0 rounded-lg px-4 text-sm font-medium transition-opacity duration-150 disabled:opacity-40"
      style={{ background: 'var(--mark-red)', color: '#fff' }}
    >
      {children}
    </button>
  );
}
