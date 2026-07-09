import { cn } from '@/lib/utils';

interface LearningDraftTitleInputProps {
  value: string;
  isDirty: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function LearningDraftTitleInput({
  value,
  isDirty,
  disabled,
  className,
  onChange,
  onSave,
}: LearningDraftTitleInputProps) {
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (isDirty) onSave();
      }}
      placeholder="篇目标题"
      aria-label="篇目标题"
      className={cn(
        'input-ghost min-w-0 truncate rounded-md px-2 py-1 text-sm font-medium leading-5 placeholder:text-[var(--ink-ghost)] disabled:cursor-default',
        className,
      )}
      style={{ color: disabled ? 'var(--ink-ghost)' : 'var(--ink-faded)' }}
    />
  );
}
