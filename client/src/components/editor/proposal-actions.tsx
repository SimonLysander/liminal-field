import { useContext } from 'react';
import { Check, X } from 'lucide-react';
import { ProposalControlsContext } from './proposal-controls-context';

interface Props {
  hunkId?: string;
}

/**
 * ProposalActions —— hunk 配对底部独立一行的接受/拒绝按钮。
 *
 * 设计:**放在 proposal-new 节点内最底部独立一行**(inline flex row,不再 absolute right)
 * - 一个 hunk(proposal-old + proposal-new 配对)只渲染**一对**按钮(在 new 块上),不在 old 块上重复
 * - 不依赖屏幕宽度,任何 viewport 都看得见
 * - 紧贴 hunk 配对下方,语义清晰("这处改动接受/拒绝")
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
        display: 'flex',
        gap: 8,
        marginTop: 6,
        paddingTop: 4,
        userSelect: 'none',
        borderTop: '1px dashed color-mix(in srgb, var(--mark-green, #3F9D57) 30%, transparent)',
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
          padding: '3px 10px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
        }}
      >
        <Check size={13} />
        接受
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
          padding: '3px 10px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
        }}
      >
        <X size={13} />
        拒绝
      </button>
    </div>
  );
}
