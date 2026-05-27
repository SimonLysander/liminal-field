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
  // 拒绝在前、接受在后 —— 让"主动接受"成为右侧的"前进按钮"位置,符合中文阅读流(否定先于肯定)
  return (
    <div
      contentEditable={false}
      style={{
        display: 'flex',
        gap: 6,
        marginTop: 4,
        paddingTop: 3,
        justifyContent: 'flex-end',
        userSelect: 'none',
        borderTop: '1px dashed color-mix(in srgb, var(--mark-green, #3F9D57) 25%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={() => ctx.rejectOne(hunkId)}
        aria-label="拒绝这处改动"
        style={{
          background: 'transparent',
          color: 'var(--mark-red, #D24B3E)',
          border: '1px solid var(--mark-red, #D24B3E)',
          borderRadius: 3,
          padding: '1px 8px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        <X size={11} />
        拒绝
      </button>
      <button
        type="button"
        onClick={() => ctx.acceptOne(hunkId)}
        aria-label="接受这处改动"
        style={{
          background: 'var(--mark-green, #3F9D57)',
          color: '#fff',
          border: '1px solid var(--mark-green, #3F9D57)',
          borderRadius: 3,
          padding: '1px 8px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        <Check size={11} />
        接受
      </button>
    </div>
  );
}
