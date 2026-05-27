import { PencilLine, Check, X } from 'lucide-react';

interface Props {
  pendingCount: number;
  totalCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/**
 * ProposalToolbar —— v3.1 审批顶部条(与编辑区同宽 + sticky)。
 *
 * 设计:
 * - **宽度跟编辑区一致**:外层 max-w + mx-auto(与 EditorContainer 同源 --layout-editor-max)
 * - **左**:笔图标 + 统计(共 N 处 · 已审 X / 剩 Y)
 * - **右**:[拒绝全部](outline 红)[接受全部](实心绿)—— 与单 hunk 按钮风格一致
 * - 半透明纸墨纹 + 浅 accent 调子,与编辑区 visual continuity
 * - pendingCount === 0 时自动隐藏(裁决完毕)
 */
export function ProposalToolbar({ pendingCount, totalCount, onAcceptAll, onRejectAll }: Props) {
  if (pendingCount === 0) return null;
  const decided = totalCount - pendingCount;

  return (
    <div
      className="sticky top-0 z-20 mx-auto w-full"
      style={{
        maxWidth: 'var(--layout-editor-max)',
        background: 'color-mix(in srgb, var(--accent) 8%, var(--paper))',
        border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
        borderRadius: 6,
        padding: '6px 12px',
        marginBottom: 8,
        fontFamily: 'var(--font-reading)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div className="flex items-center gap-3 text-sm">
        {/* 左:统计 */}
        <div className="flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <PencilLine size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 500 }}>共 {totalCount} 处改动</span>
          <span style={{ color: 'var(--ink-faded)', fontSize: 12 }}>
            ·{' '}
            {decided > 0 && (
              <>
                已审 <strong style={{ color: 'var(--ink)' }}>{decided}</strong> ·{' '}
              </>
            )}
            待审 <strong style={{ color: 'var(--accent)' }}>{pendingCount}</strong>
          </span>
          {/* 快捷键提示:Y/N 接受拒绝当前,J/K 上下跳,⌘⏎/⌘⌫ 全接全拒 */}
          <span
            className="ml-3 hidden md:inline"
            style={{
              color: 'var(--ink-ghost)',
              fontSize: 11,
              fontFamily: 'var(--font-mono, ui-monospace)',
            }}
            title="审批快捷键"
          >
            Y 接受 · N 拒绝 · J/K 上下 · ⌘⏎ 全接 · ⌘⌫ 全拒
          </span>
        </div>

        {/* 右:全部按钮 */}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onRejectAll}
            aria-label="拒绝全部改动"
            style={{
              background: 'transparent',
              color: 'var(--mark-red, #D24B3E)',
              border: '1px solid var(--mark-red, #D24B3E)',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            <X size={12} />
            拒绝全部
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            aria-label="接受全部改动"
            style={{
              background: 'var(--mark-green, #3F9D57)',
              color: '#fff',
              border: '1px solid var(--mark-green, #3F9D57)',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            <Check size={12} />
            接受全部
          </button>
        </div>
      </div>
    </div>
  );
}
