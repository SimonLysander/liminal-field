/**
 * ActionButton — 带 ✓ 反馈的操作按钮
 *
 * Apple HIG 风格：操作成功后文字淡出、✓ 淡入，1.5 秒后恢复。
 * 内部管理 flash 状态，冻结 label 防止布局跳动。
 *
 * onClick 返回 true 表示成功（显示 ✓），返回 false/undefined 或抛异常则不显示。
 */

import { useState } from 'react';

interface ActionButtonProps {
  label: string;
  danger?: boolean;
  /** 返回 true 触发 ✓ 反馈，返回 false 或抛异常不触发 */
  onClick: () => Promise<boolean | void>;
}

export function ActionButton({ label, danger, onClick }: ActionButtonProps) {
  const [flash, setFlash] = useState(false);
  const [displayLabel, setDisplayLabel] = useState(label);
  const [prevFlash, setPrevFlash] = useState(false);
  const [prevLabel, setPrevLabel] = useState(label);

  // render-time 同步：label 变化或 flash 结束时更新 displayLabel
  if (label !== prevLabel || (!flash && prevFlash)) {
    setPrevLabel(label);
    setPrevFlash(flash);
    if (!flash) setDisplayLabel(label);
  }
  if (flash !== prevFlash) setPrevFlash(flash);

  const handleClick = async () => {
    if (flash) return;
    try {
      const result = await onClick();
      if (result === false) return;
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
    } catch {
      // 错误由调用方处理，不显示 ✓
    }
  };

  const color = danger && !flash ? 'var(--mark-red)' : 'var(--ink-faded)';

  return (
    <button
      className="relative inline-flex items-center justify-center transition-colors duration-150"
      style={{
        color,
        fontSize: 'var(--text-xs)',
        background: 'none',
        border: 'none',
        cursor: flash ? 'default' : 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onMouseEnter={(e) => {
        if (!danger && !flash) e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = color;
      }}
      onClick={() => void handleClick()}
    >
      {/* 文字层：flash 时淡出 */}
      <span
        className="transition-opacity duration-200"
        style={{ opacity: flash ? 0 : 1 }}
      >
        {displayLabel}
      </span>
      {/* ✓ 覆盖层：flash 时淡入 */}
      <span
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
        style={{ opacity: flash ? 1 : 0, pointerEvents: 'none' }}
      >
        ✓
      </span>
    </button>
  );
}
