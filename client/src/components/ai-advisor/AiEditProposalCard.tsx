import { PencilLine, AlertTriangle, ArrowDown } from 'lucide-react';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';

interface Props {
  proposal: Proposal;
  failure?: { kind: 'invalid' | 'parse-error'; message: string };
  onJumpToEditor?: () => void;
}

/**
 * AiEditProposalCard —— v3 聊天里的"已生成改稿"卡片。
 *
 * Aurora 调 propose_document_rewrite 后，聊天显示这张卡片：
 * - 顶部：PencilLine 图标 + "已生成改稿，N 处改动待你审批"
 * - 下方：reason 一句话
 * - 跳转按钮提示："在编辑器审批"
 *
 * 失败时（invalid/parse-error）：红色边线 + 错误文案。
 */
export function AiEditProposalCard({ proposal, failure, onJumpToEditor }: Props) {
  if (failure) {
    return (
      <div
        className="my-1 border-l-2 pl-3"
        style={{ borderColor: 'var(--mark-red, #d63b3b)' }}
      >
        <div
          className="flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--mark-red, #d63b3b)' }}
        >
          <AlertTriangle size={13} /> 未生成有效改稿
        </div>
        <div
          className="mt-1 text-xs"
          style={{ color: 'var(--ink-faded)' }}
        >
          {failure.message}
        </div>
      </div>
    );
  }
  const n = proposal.hunks.length;
  return (
    <div
      className="my-1 cursor-pointer border-l-2 pl-3 hover:bg-[color:color-mix(in_srgb,var(--accent)_4%,transparent)]"
      style={{ borderColor: 'var(--accent)' }}
      onClick={onJumpToEditor}
    >
      <div
        className="flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--ink)' }}
      >
        <PencilLine
          size={13}
          strokeWidth={2}
          style={{ color: 'var(--accent)' }}
        />
        已生成改稿 · {n} 处改动
      </div>
      {proposal.reason && (
        <div
          className="mt-1 text-xs"
          style={{ color: 'var(--ink-faded)' }}
        >
          {proposal.reason}
        </div>
      )}
      <div
        className="mt-1 flex items-center gap-1 text-xs"
        style={{ color: 'var(--accent)' }}
      >
        <ArrowDown size={11} /> 在编辑器审批
      </div>
    </div>
  );
}
