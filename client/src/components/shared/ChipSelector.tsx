/**
 * ChipSelector — 共享 chip + popover 加法选择器。
 *
 * 用于「从列表里多选子集」场景:工具池、技能授权、未来任何类似选择。
 * 替代 16-checkbox 列表的「捞」感,统一项目 chip 风格。
 *
 * 视觉规格(对齐设计语言 docs/design-system.md):
 * - chip 高度 28px(h-7),圆角 rounded-full,bg-shelf 背景
 * - 字号 text-sm,副标记 text-2xs + ink-ghost
 * - × hover 时切 var(--danger) 红字
 * - popover 分组「可添加」在前,「不可添加」在后
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §6.1
 */

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, X } from 'lucide-react';

interface Props<T = string> {
  selected: T[];
  available: T[];
  onAdd: (item: T) => void;
  onRemove: (item: T) => void;
  /** chip / popover 显示文本(默认 String(item)) */
  renderLabel?: (item: T) => string;
  /** chip 右侧副标记(如 skill 的「· 需 web_search」) */
  renderMeta?: (item: T) => string | undefined;
  /** popover 内分组键(如「可添加 / 不可添加」) */
  groupBy?: (item: T) => string;
  /** 返回 string 时项不可选,tooltip 显示原因 */
  disabledReason?: (item: T) => string | undefined;
  addLabel?: string; // 默认「+ 添加」
}

export function ChipSelector<T extends string>({
  selected,
  available,
  onAdd,
  onRemove,
  renderLabel = (i) => String(i),
  renderMeta,
  groupBy,
  disabledReason,
  addLabel = '+ 添加',
}: Props<T>) {
  const [open, setOpen] = useState(false);

  /* popover 候选 = available 中未被 selected 的 */
  const candidates = available.filter((i) => !selected.includes(i));

  /* 按 groupBy 分组(无 groupBy → 全部塞「全部」组) */
  const grouped: Record<string, T[]> = {};
  for (const c of candidates) {
    const k = groupBy?.(c) ?? '';
    (grouped[k] ??= []).push(c);
  }
  /* 「可添加」组排前,「不可添加」排后(惯例) */
  const orderedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === '不可添加') return 1;
    if (b === '不可添加') return -1;
    return 0;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.map((item) => (
        <span
          key={String(item)}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--shelf)] px-3 text-sm"
        >
          <span>{renderLabel(item)}</span>
          {renderMeta?.(item) && (
            <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
              · {renderMeta(item)}
            </span>
          )}
          <button
            type="button"
            aria-label={`移除 ${renderLabel(item)}`}
            onClick={() => onRemove(item)}
            className="text-[var(--ink-faded)] transition-colors duration-100 hover:text-[var(--danger)]"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--separator)] px-3 text-sm text-[var(--ink-faded)] hover:bg-[var(--shelf)]"
          >
            <Plus size={12} /> {addLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {orderedKeys.map((groupKey) => (
            <div key={groupKey || 'default'}>
              {groupKey && (
                <div
                  className="px-2 py-1 text-2xs"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  {groupKey}
                </div>
              )}
              {grouped[groupKey].map((item) => {
                const reason = disabledReason?.(item);
                const disabled = !!reason;
                return (
                  <div
                    key={String(item)}
                    role="button"
                    aria-disabled={disabled}
                    title={reason || undefined}
                    className={
                      'flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm ' +
                      (disabled
                        ? 'cursor-not-allowed opacity-40'
                        : 'hover:bg-[var(--shelf)]')
                    }
                    onClick={() => {
                      if (disabled) return;
                      onAdd(item);
                      setOpen(false);
                    }}
                  >
                    <span>{renderLabel(item)}</span>
                    {renderMeta?.(item) && (
                      <span
                        className="text-2xs"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        {renderMeta(item)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
