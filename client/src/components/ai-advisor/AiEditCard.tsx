/**
 * AiEditCard — 聊天里展示 v2 改稿工具(rewrite_selection / insert_at_cursor / rewrite_document)的结果卡片。
 *
 * 视觉严格对齐 ProposedEditCard:
 *   - 左边线 var(--accent)、fontFamily var(--font-reading)
 *   - tool-coalesce 入场动画
 *   - text-sm 头行 / text-xs 描述
 *   - 失败时 var(--mark-red) + AlertTriangle 图标
 *
 * outcome prop 可选:未传(改稿正在进行/成功无 outcome)时只渲染 reason;
 * 传入失败 outcome 时描述行标红并追加定位失败说明,绝不静默。
 */

import { PencilLine, AlertTriangle } from 'lucide-react';
import type { AiEditTool, AiEditOutcome } from '@/pages/admin/lib/apply-ai-edit';

const TOOL_LABEL: Record<AiEditTool, string> = {
  rewrite_selection: '改写选中段',
  insert_at_cursor: '在光标处插入',
  rewrite_document: '整篇改写',
};

interface Props {
  tool: AiEditTool;
  /** AI 给的改稿理由(模型在 input.reason 中传入) */
  reason: string;
  /** 改稿应用结果(可选);传入后按 ok/reason 决定是否标红 */
  outcome?: AiEditOutcome;
}

export function AiEditCard({ tool, reason, outcome }: Props) {
  // 类型守卫:先判 outcome 存在 + !ok,再在分支内 narrow 到失败分支读 outcome.reason
  const failed = outcome != null && !outcome.ok;
  const failMsg =
    failed && !outcome.ok
      ? outcome.reason === 'no-anchor'
        ? '需要先在编辑器里选中要改的段(或把光标放到要插入的位置)'
        : '未生成有效改动,请重试'
      : '';

  return (
    // 左边线 accent、font-reading、tool-coalesce 动画 —— 对齐 ProposedEditCard
    <div
      className="my-1 border-l-2 pl-3"
      style={{
        borderColor: 'var(--accent)',
        fontFamily: 'var(--font-reading)',
        animation: 'tool-coalesce 0.4s ease-out',
      }}
    >
      {/* 头行:PencilLine + 工具中文名(text-sm,与 ProposedEditCard 「已提议 N 处修改」行对齐) */}
      <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ink)' }}>
        <PencilLine size={13} strokeWidth={2} className="shrink-0" style={{ color: 'var(--accent)' }} />
        {TOOL_LABEL[tool]}
      </div>

      {/* 描述行:reason + 失败时追加说明,失败标红 */}
      <div
        className="mt-1 text-xs"
        style={{ color: failed ? 'var(--mark-red)' : 'var(--ink-faded)' }}
      >
        {failed && (
          <AlertTriangle size={12} strokeWidth={2} className="mr-1 inline shrink-0" />
        )}
        {reason}
        {failed && ` —— ${failMsg}`}
      </div>
    </div>
  );
}
