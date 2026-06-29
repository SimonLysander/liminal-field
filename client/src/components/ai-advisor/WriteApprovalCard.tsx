/**
 * WriteApprovalCard — HITL 写工具审批卡(纯通用)。
 *
 * 只认统一契约 ApprovalPreview 三层,零 toolName 判断、零字段猜测:
 *   summary 改动摘要(顶) / items 改动预览(中:目录项+片段) / stats 改动统计(底)。
 * 各写工具把自己的内容映射成这同一 shape(在后端 buildPreview 一处),卡片不感知具体工具。
 *
 * 被门禁的写工具输出 pending_approval 时浮现,允许/拒绝后才真正落库。
 * 裁决结果用 resolved-store(localStorage)持久化:刷新后不重现按钮(只记 callId,不分方向)。
 */

import { useState } from 'react';
import { approveWrite, rejectWrite } from '@/services/agent';
import { readResolved, markResolved } from '@/pages/admin/lib/resolved-store';
import { banner } from '@/components/ui/banner-api';

interface PreviewItem {
  label?: string;
  snippet?: string;
}

export interface WriteApprovalCardProps {
  toolCallId: string;
  sessionKey: string;
  /** 工具结果 meta,含统一契约字段 summary / items / ordered / stats */
  preview: Record<string, unknown>;
  /** 允许后回调(如刷新左栏产出) */
  onApproved?: () => void;
}

type ResolvedState = 'approved' | 'rejected' | 'already' | null;

export function WriteApprovalCard({
  toolCallId,
  sessionKey,
  preview,
  onApproved,
}: WriteApprovalCardProps) {
  const [resolved, setResolved] = useState<ResolvedState>(() =>
    readResolved().has(toolCallId) ? 'already' : null,
  );
  const [loading, setLoading] = useState(false);

  // 统一契约三层(纯读取,不按工具分支)
  const summary = typeof preview.summary === 'string' ? preview.summary : '';
  const items = (Array.isArray(preview.items) ? preview.items : []) as PreviewItem[];
  const ordered = preview.ordered === true;
  const stats = typeof preview.stats === 'string' ? preview.stats : '';

  // 必须看后端返回的 status:只有 'ok' 才是真落库。否则(sessionKey 不符 forbidden /
  // not_found)绝不能 markResolved + 显示成功——那会让用户以为审批生效、实则没落库(踩过的坑)。
  const handleApprove = async () => {
    if (loading || resolved) return;
    setLoading(true);
    try {
      const { status } = await approveWrite(toolCallId, sessionKey);
      if (status === 'ok') {
        markResolved(toolCallId);
        setResolved('approved');
        onApproved?.();
      } else if (status === 'already_resolved') {
        markResolved(toolCallId);
        setResolved('already');
      } else {
        banner.error(`审批未生效(${status}),未落库,请刷新后重试`);
      }
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
      const { status } = await rejectWrite(toolCallId, sessionKey);
      if (status === 'ok') {
        markResolved(toolCallId);
        setResolved('rejected');
      } else if (status === 'already_resolved') {
        markResolved(toolCallId);
        setResolved('already');
      } else {
        banner.error(`拒绝未生效(${status}),请刷新后重试`);
      }
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '拒绝失败，请重试');
    } finally {
      setLoading(false);
    }
  };

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
      {/* 顶:改动摘要 */}
      {summary && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
          {summary}
        </p>
      )}

      {/* 中:改动预览——目录项 + 各自片段 */}
      {items.length > 0 && (
        <ul
          className={`max-h-56 space-y-1.5 overflow-y-auto ${summary ? 'mt-2.5' : ''}`}
        >
          {items.map((it, i) => (
            <li key={i} className="flex gap-1.5">
              {ordered && (
                <span
                  className="shrink-0 tabular-nums text-sm"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  {i + 1}.
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                  {it.label}
                </div>
                {it.snippet && (
                  <div
                    className="mt-0.5 truncate text-xs"
                    style={{ color: 'var(--ink-faded)' }}
                  >
                    {it.snippet}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 底:改动统计 */}
      {stats && (
        <p className="mt-2.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {stats}
        </p>
      )}

      {/* 未裁决 → 允许/拒绝;已裁决 → 状态标(内容仍在上方) */}
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
