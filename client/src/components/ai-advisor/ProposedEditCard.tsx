/**
 * ProposedEditCard — 聊天里展示 Aurora 提议修改的卡片。
 *
 * 视觉对齐 ToolCallCard:左边线用 var(--accent),字号 text-xs/text-base/text-sm,
 * 颜色变量复用 var(--ink)/var(--ink-faded)/var(--accent)/var(--mark-red)。
 *
 * outcomes 为可选 prop:
 *   - 本 task 不传,卡片只渲染 reason 列表(成功态)。
 *   - 下个 task 接入后传入,失败条目标红并附说明。
 */

import { PencilLine, AlertTriangle } from 'lucide-react';
import type { EditOutcome } from '@/pages/admin/lib/apply-proposed-edits';

interface Props {
  edits: Array<{ find: string; replace: string; reason: string }>;
  /** 应用结果(可选,本 task 不传;下个 task 接入做标红) */
  outcomes?: EditOutcome[];
  /** 点击跳转到编辑器第一处 suggestion(下个 task 接入) */
  onJumpFirst?: () => void;
}

export function ProposedEditCard({ edits, outcomes, onJumpFirst }: Props) {
  // outcomes 未传时,假设全部成功,显示 edits.length
  const okCount = outcomes?.filter((o) => o.ok).length ?? edits.length;

  return (
    // 左边线用 accent(与 ToolCallCard 的边线同侧;颜色区分:propose_edit 用主色而非 separator)
    <div
      className="my-1 border-l-2 pl-3"
      style={{
        borderColor: 'var(--accent)',
        fontFamily: 'var(--font-reading)',
        animation: 'tool-coalesce 0.4s ease-out',
      }}
    >
      {/* 头行:图标 + 「已提议 N 处修改」+ 可选跳转按钮 */}
      <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ink)' }}>
        <PencilLine
          size={13}
          strokeWidth={2}
          className="shrink-0"
          style={{ color: 'var(--accent)' }}
        />
        已提议 {okCount} 处修改
        {onJumpFirst && (
          <button
            className="ml-1 text-xs underline"
            style={{ color: 'var(--accent)' }}
            onClick={onJumpFirst}
          >
            跳到第一处
          </button>
        )}
      </div>

      {/* reason 列表:每条一行,失败时标红并附定位失败原因 */}
      <ul className="mt-1 space-y-0.5">
        {edits.map((e, i) => {
          const o = outcomes?.[i];
          const failed = o && !o.ok;
          return (
            <li
              key={i}
              className="flex items-baseline gap-1 text-xs"
              style={{ color: failed ? 'var(--mark-red)' : 'var(--ink-faded)' }}
            >
              {failed && (
                <AlertTriangle
                  size={12}
                  strokeWidth={2}
                  className="mt-px shrink-0"
                  style={{ color: 'var(--mark-red)' }}
                />
              )}
              <span>
                {e.reason}
                {/* 失败时追加定位失败说明,帮用户理解原因 */}
                {failed &&
                  (o.reason === 'not-found'
                    ? ` —— 没在正文里定位到「${e.find.slice(0, 12)}…」,可能正文已改,请手动确认`
                    : ` —— 「${e.find.slice(0, 12)}…」不唯一,请提供更长的原文片段`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
