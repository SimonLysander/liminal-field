/**
 * WriteApprovalCard — HITL 写工具审批卡(纯通用)。
 *
 * 只认统一契约 ApprovalPreview 三层,零 toolName 判断、零字段猜测:
 *   summary 改动摘要(顶) / items 改动预览(中:目录项+片段) / stats 改动统计(底)。
 * 各写工具把自己的内容映射成这同一 shape(在后端 buildPreview 一处),卡片不感知具体工具。
 *
 * 被门禁的写工具输出 pending_approval 时浮现,允许/拒绝后才真正落库。
 * 裁决结果由会话加载接口返回，Mongo 是唯一真源；不依赖单台浏览器 localStorage。
 */

import { useState } from 'react';
import {
  approveWrite,
  rejectWrite,
  type WriteApproval,
  type WriteApprovalStatus,
  type WriteCommitResult,
} from '@/services/agent';
import { banner } from '@/components/ui/banner-api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('write-approval');
const APPROVAL_POLL_DELAYS_MS = [400, 800, 1_200, 1_600, 2_000, 2_000, 2_000];

interface PreviewItem {
  label?: string;
  snippet?: string;
}

export interface WriteApprovalCardProps {
  toolCallId: string;
  sessionKey: string;
  /** 工具结果 meta,含统一契约字段 summary / items / ordered / stats */
  preview: Record<string, unknown>;
  /** 后端随会话加载批量返回的权威状态与裁决时间。 */
  approval?: WriteApproval;
  /** 裁决成功后同步更新父级状态，避免等待下次加载才刷新卡片。 */
  onStatusChange?: (
    toolCallId: string,
    approval: WriteApproval,
  ) => void;
  /** committing 竞态时重读服务端状态，避免卡片长期停在可重复操作状态。 */
  onStatusRefresh?: (toolCallId: string) => Promise<WriteApproval | undefined>;
  /** 允许后回调(如刷新左栏产出) */
  onApproved?: () => void;
}

type TerminalApprovalStatus = Exclude<WriteApprovalStatus, 'pending'>;
type TerminalWriteApproval = Extract<
  WriteApproval,
  { status: TerminalApprovalStatus }
>;

function formatResolvedAt(resolvedAt: string | null): string | null {
  if (!resolvedAt) return null;
  const date = new Date(resolvedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\s+/g, ' ');
}

function approvalStatusLabel(status: WriteApprovalStatus): string {
  switch (status) {
    case 'approved':
      return '已写入 ✓';
    case 'rejected':
      return '已拒绝';
    case 'superseded':
      return '已被更新内容取代';
    case 'expired':
      return '审批已过期';
    case 'pending':
      return '';
  }
}

function approvalFromCommitResult(
  result: WriteCommitResult,
  requestedStatus: 'approved' | 'rejected',
): TerminalWriteApproval | null {
  switch (result.status) {
    case 'ok':
      return { status: requestedStatus, resolvedAt: result.resolvedAt };
    case 'already_resolved':
      return { status: result.resolution, resolvedAt: result.resolvedAt };
    case 'superseded':
      return { status: 'superseded', resolvedAt: result.resolvedAt };
    case 'expired':
      return { status: 'expired', resolvedAt: null };
    default:
      return null;
  }
}

export function WriteApprovalCard({
  toolCallId,
  sessionKey,
  preview,
  approval,
  onStatusChange,
  onStatusRefresh,
  onApproved,
}: WriteApprovalCardProps) {
  const [resolved, setResolved] = useState<WriteApproval | null>(null);
  const [loading, setLoading] = useState(false);
  // 实时流刚产出时，会话加载的状态表尚未刷新；这时才暂按 pending 展示。
  // 历史卡片由服务端显式补齐 expired，不会因此错误地获得审批按钮。
  const effectiveApproval = resolved ?? approval ?? {
    status: 'pending',
    resolvedAt: null,
  };
  const effectiveStatus = effectiveApproval.status;
  const canResolve = effectiveStatus === 'pending';

  // 统一契约三层(纯读取,不按工具分支)
  const summary = typeof preview.summary === 'string' ? preview.summary : '';
  const items = (Array.isArray(preview.items) ? preview.items : []) as PreviewItem[];
  const ordered = preview.ordered === true;
  const stats = typeof preview.stats === 'string' ? preview.stats : '';

  const applyTerminalApproval = (terminalApproval: TerminalWriteApproval) => {
    const terminalStatus: TerminalApprovalStatus = terminalApproval.status;
    setResolved(terminalApproval);
    onStatusChange?.(toolCallId, terminalApproval);
    if (terminalStatus === 'approved') onApproved?.();
    if (terminalStatus === 'superseded') {
      banner.info('这项修改已被更新的内容取代');
    }
  };

  const applyTerminalStatus = (
    result: WriteCommitResult,
    requestedStatus: 'approved' | 'rejected',
  ): boolean => {
    const terminalApproval = approvalFromCommitResult(result, requestedStatus);
    if (!terminalApproval) return false;
    applyTerminalApproval(terminalApproval);
    return true;
  };

  const refreshInProgressStatus = async () => {
    if (!onStatusRefresh) return false;
    for (const delayMs of APPROVAL_POLL_DELAYS_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      try {
        const refreshed = await onStatusRefresh(toolCallId);
        if (refreshed && refreshed.status !== 'pending') {
          applyTerminalApproval(refreshed);
          return true;
        }
      } catch (error) {
        logger.warn('status_refresh_failed', {
          toolCallId,
          errorType: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return false;
  };

  // 必须看后端返回的 status，非终态结果绝不显示为已落库。
  const handleApprove = async () => {
    if (loading || !canResolve) return;
    setLoading(true);
    try {
      const result = await approveWrite(toolCallId, sessionKey);
      if (applyTerminalStatus(result, 'approved')) return;
      if (result.status === 'in_progress') {
        banner.info('审批正在处理');
        if (!(await refreshInProgressStatus())) {
          banner.info('审批仍在处理，请稍后查看');
        }
      } else {
        banner.error(`审批未生效(${result.status})，请重试`);
      }
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '审批失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (loading || !canResolve) return;
    setLoading(true);
    try {
      const result = await rejectWrite(toolCallId, sessionKey);
      if (applyTerminalStatus(result, 'rejected')) return;
      if (result.status === 'in_progress') {
        banner.info('审批正在处理');
        if (!(await refreshInProgressStatus())) {
          banner.info('审批仍在处理，请稍后查看');
        }
      } else {
        banner.error(`拒绝未生效(${result.status})，请重试`);
      }
    } catch (err) {
      banner.error(err instanceof Error ? err.message : '拒绝失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = approvalStatusLabel(effectiveStatus);
  const resolvedAtLabel =
    effectiveStatus === 'approved' || effectiveStatus === 'rejected'
      ? formatResolvedAt(effectiveApproval.resolvedAt)
      : null;

  return (
    <div
      className="my-1 rounded-md border px-3 py-2.5"
      style={{
        borderColor: 'var(--separator)',
        background: canResolve ? 'var(--shelf)' : 'transparent',
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
      {!canResolve ? (
        <p className="mt-2.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {statusLabel}
          {resolvedAtLabel && (
            <>
              {' · '}
              <time dateTime={effectiveApproval.resolvedAt ?? undefined}>
                {resolvedAtLabel}
              </time>
            </>
          )}
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
