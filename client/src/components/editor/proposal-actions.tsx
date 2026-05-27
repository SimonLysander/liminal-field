import { useContext } from 'react';
import { Check, X } from 'lucide-react';
import { ProposalControlsContext } from './proposal-controls-context';

interface Props {
  hunkId?: string;
}

/**
 * ProposalActions —— 元素右侧浮按钮(✓ 接受 / ✗ 拒绝)。
 *
 * 位置:绝对定位在父 element 右侧外(right: -110),仅相对父元素定位 ——
 * 父元素是块级节点,布局明确,不存在 v3 absolute overlay 的 offsetParent 不确定问题。
 *
 * contentEditable={false} 让 Plate readOnly 期间按钮可点击但不被当作可编辑文本。
 */
export function ProposalActions({ hunkId }: Props) {
  const ctx = useContext(ProposalControlsContext);
  if (!hunkId || !ctx) return null;
  return (
    <div
      contentEditable={false}
      style={{
        position: 'absolute',
        right: -110,
        top: 0,
        display: 'flex',
        gap: 4,
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => ctx.acceptOne(hunkId)}
        aria-label="接受这处改动"
        style={{
          background: 'var(--mark-green, #3F9D57)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onClick={() => ctx.rejectOne(hunkId)}
        aria-label="拒绝这处改动"
        style={{
          background: 'var(--mark-red, #D24B3E)',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
