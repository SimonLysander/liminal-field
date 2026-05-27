import { Check, X } from 'lucide-react';

interface Props {
  pendingCount: number;
  totalCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/**
 * ProposalToolbar —— v3 审批顶部固定条。
 *
 * 仅在有 pending hunks 时显示;全裁决完由父级(ProposalBridge)控制隐藏(pendingCount 变为 0 时
 * 此组件自动返回 null)。
 *
 * 设计系统:纸墨 + 长春花紫 accent;红绿语义(接受绿、拒绝红)。
 * sticky 贴顶防滚动后裁决入口消失。
 */
export function ProposalToolbar({ pendingCount, totalCount, onAcceptAll, onRejectAll }: Props) {
  if (pendingCount === 0) return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-sm sticky top-0 z-20"
      style={{
        background: 'color-mix(in srgb, var(--accent) 6%, var(--paper))',
        borderBottom: '1px solid var(--separator)',
        fontFamily: 'var(--font-reading)',
      }}
    >
      <span style={{ color: 'var(--ink-faded)' }}>
        剩余 {pendingCount} / 共 {totalCount} 处改动
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onAcceptAll}
          className="flex items-center gap-1 px-3 py-1 rounded text-xs"
          style={{
            background: 'var(--mark-green, #2da44e)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Check size={12} /> 全部接受
        </button>
        <button
          type="button"
          onClick={onRejectAll}
          className="flex items-center gap-1 px-3 py-1 rounded text-xs"
          style={{
            background: 'var(--mark-red, #d63b3b)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <X size={12} /> 全部拒绝
        </button>
      </div>
    </div>
  );
}
