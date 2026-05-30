import { useContext } from 'react';
import { ProposalControlsContext } from './proposal-controls-context';

interface Props {
  hunkId?: string;
}

/**
 * ProposalActions —— hunk 配对底部独立一行的接受/拒绝按钮。
 *
 * 设计:**放在 proposal-new 节点内最底部独立一行**(inline flex row)
 * - 一个 hunk(proposal-old + proposal-new 配对)只渲染**一对**按钮(在 new 块上)
 * - ghost 风格(小而精致,无边框):拒绝 mark-red 字 / 接受 accent(长春花紫)字,
 *   hover 才显浅色块。跟顶栏"拒绝全部/接受全部"风格一致。
 * - 接受用 accent 而非绿 —— 绿留给"已发布/成功"语义,改稿接受用主题色
 *
 * contentEditable={false} 让 Plate readOnly 期间按钮可点击但不被当作可编辑文本。
 */
export function ProposalActions({ hunkId }: Props) {
  const ctx = useContext(ProposalControlsContext);
  if (!hunkId || !ctx) return null;
  // 拒绝在前、接受在后 —— "主动接受"落在右侧"前进"位置
  return (
    <div
      contentEditable={false}
      className="proposal-actions-row"
      style={{
        display: 'flex',
        gap: 2,
        marginTop: 4,
        paddingTop: 3,
        justifyContent: 'flex-end',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => ctx.rejectOne(hunkId)}
        aria-label="拒绝这处改动"
        className="rounded-md px-2 py-0.5 text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--mark-red)_10%,transparent)]"
        style={{ color: 'var(--mark-red)' }}
      >
        拒绝
      </button>
      <button
        type="button"
        onClick={() => ctx.acceptOne(hunkId)}
        aria-label="接受这处改动"
        className="rounded-md px-2 py-0.5 text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
        style={{ color: 'var(--accent)', fontWeight: 500 }}
      >
        接受
      </button>
    </div>
  );
}
