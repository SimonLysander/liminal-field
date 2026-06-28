/**
 * WriteApprovalCard — HITL 写工具审批卡。
 *
 * 被门禁的写工具(write_draft / write_learn_plan / write_tasks / remember)在
 * 会话流里输出 pending_approval 时,此卡片浮现,让用户"允许 / 拒绝"后才真正落库。
 *
 * 审批结果通过 resolved-store(localStorage)持久化:刷新后不重现按钮。
 * 仅记录 callId,不区分 approve/reject,所以 localStorage 命中只显示"已处理"。
 */

import { useState } from 'react';
import { approveWrite, rejectWrite } from '@/services/agent';
import { readResolved, markResolved } from '@/pages/admin/lib/resolved-store';
import { banner } from '@/components/ui/banner-api';

export interface WriteApprovalCardProps {
  toolCallId: string;
  sessionKey: string;
  /** 工具名,已去掉 'tool-' 前缀:write_draft / write_learn_plan / write_tasks / remember */
  toolName: string;
  /** 整个 meta 对象,含 status / toolCallId / preview 字段 */
  preview: Record<string, unknown>;
  /** 允许后回调(如刷新左栏产出) */
  onApproved?: () => void;
}

/** 裁决状态:null=未裁决 | 'approved'/'rejected'=本次 | 'already'=localStorage 已记录 */
type ResolvedState = 'approved' | 'rejected' | 'already' | null;

/** 按工具名 + preview 字段拼用户可读描述 */
function buildDescription(
  toolName: string,
  preview: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'write_draft':
      return `准备写初稿《${String(preview.title ?? '')}》(${String(preview.charCount ?? '')} 字)`;
    case 'write_learn_plan':
      return `准备写规划《${String(preview.title ?? '')}》(${String(preview.itemsCount ?? '')} 篇提案)`;
    case 'write_tasks':
      return `准备更新任务清单(${String(preview.count ?? '')} 项)`;
    case 'remember':
      return `准备记下 ${String(preview.count ?? '')} 条记忆`;
    default:
      return `准备执行 ${toolName}`;
  }
}

export function WriteApprovalCard({
  toolCallId,
  sessionKey,
  toolName,
  preview,
  onApproved,
}: WriteApprovalCardProps) {
  // 初值:localStorage 已有此 callId → 显示"已处理"(不知方向),否则等待用户裁决
  const [resolved, setResolved] = useState<ResolvedState>(() =>
    readResolved().has(toolCallId) ? 'already' : null,
  );
  const [loading, setLoading] = useState(false);

  const description = buildDescription(toolName, preview);

  // 内容梗概:审批前看清「要写什么」。summary=首段;list=篇目/任务/觉察/小标题(取先出现的)。
  const summary = typeof preview.summary === 'string' ? preview.summary : '';
  const listField = (['items', 'titles', 'observations', 'outline'] as const).find(
    (k) => Array.isArray(preview[k]),
  );
  const list = (listField ? (preview[listField] as unknown[]) : [])
    .map((x) => String(x))
    .filter((s) => s.trim().length > 0);
  const ordered = listField === 'items' || listField === 'titles';

  const handleApprove = async () => {
    if (loading || resolved) return;
    setLoading(true);
    try {
      await approveWrite(toolCallId, sessionKey);
      markResolved(toolCallId);
      setResolved('approved');
      onApproved?.();
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '审批失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (loading || resolved) return;
    setLoading(true);
    try {
      await rejectWrite(toolCallId, sessionKey);
      markResolved(toolCallId);
      setResolved('rejected');
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '拒绝失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 裁决后内容不消失,只把底部按钮换成状态标(draft/plan 还能去左栏看,tasks/remember 全靠这张卡留痕)
  const statusLabel =
    resolved === 'approved'
      ? '已写入 ✓'
      : resolved === 'rejected'
        ? '已拒绝'
        : resolved === 'already'
          ? '已处理'
          : '';

  return (
    <div
      className="my-1 rounded-md border px-3 py-2.5"
      style={{
        borderColor: 'var(--separator)',
        background: resolved ? 'transparent' : 'var(--shelf)',
      }}
    >
      {/* 操作描述 */}
      <p className="text-sm" style={{ color: 'var(--ink)' }}>
        {description}
      </p>

      {/* 内容梗概:首段摘要 + 结构列表(篇目/任务/觉察/小标题),审批前看清要写什么 */}
      {summary && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          {summary}
        </p>
      )}
      {list.length > 0 && (
        <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto text-xs" style={{ color: 'var(--ink-faded)' }}>
          {list.map((line, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
                {ordered ? `${i + 1}.` : '·'}
              </span>
              <span className="min-w-0 flex-1 truncate">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 底部:未裁决 → 允许/拒绝按钮;已裁决 → 状态标(内容仍在上方) */}
      {resolved ? (
        <p className="mt-2.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {statusLabel}
        </p>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={loading}
            className="rounded-md px-3 py-1 text-sm font-medium outline-none transition-opacity disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
          >
            {loading ? '处理中…' : '允许'}
          </button>
          <button
            type="button"
            onClick={() => void handleReject()}
            disabled={loading}
            className="rounded-md border px-3 py-1 text-sm outline-none transition-colors hover:bg-[var(--paper)] disabled:opacity-50"
            style={{ color: 'var(--ink-faded)', borderColor: 'var(--separator)' }}
          >
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}
