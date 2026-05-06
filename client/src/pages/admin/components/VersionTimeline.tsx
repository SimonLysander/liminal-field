// 共享的版本时间线组件，供 Notes 和 Gallery 管理页复用

import type { ContentHistoryEntry } from '@/services/workspace';

/** 跨天显示 "M/D HH:mm"，当天只显示 "HH:mm" */
function formatCommitTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function VersionTimeline({
  history,
  publishedHash,
  activePreviewHash,
  onSelect,
}: {
  history: ContentHistoryEntry[];
  publishedHash: string | null;
  activePreviewHash?: string | null;
  onSelect?: (commitHash: string) => void;
}) {
  return (
    <div className="relative" style={{ paddingLeft: 16 }}>
      {/* 纵线 — 居中对齐圆点（圆点 center = left -12 + 16 + 3.5 = 7.5） */}
      <div
        className="absolute"
        style={{
          left: 7,
          top: 8,
          bottom: 8,
          width: 1,
          background: 'var(--box-border)',
        }}
      />
      {history.map((entry, i) => {
        const isPublished = publishedHash === entry.commitHash;
        const isFirst = i === 0;
        /* 没有预览旧版本时，默认高亮最新版本 */
        const isActive = activePreviewHash
          ? activePreviewHash === entry.commitHash
          : isFirst;
        const title = entry.message.split(' | ')[1]?.trim()
          || (entry.action === 'commit' ? '正式版本提交' : '版本更新');

        return (
          <div
            key={entry.commitHash}
            className="relative cursor-pointer transition-all duration-150 hover:opacity-80"
            style={{
              padding: '8px 0 8px 12px',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              borderRadius: isActive ? 'var(--radius-sm)' : 0,
            }}
            onClick={() => onSelect?.(entry.commitHash)}
          >
            {/* 节点圆点 */}
            <span
              className="absolute rounded-full"
              style={{
                left: -12,
                top: 12,
                width: 7,
                height: 7,
                background: isActive
                  ? 'var(--mark-blue)'
                  : isPublished
                    ? 'var(--mark-green)'
                    : isFirst
                      ? 'var(--ink)'
                      : 'var(--ink-ghost)',
                border: '1.5px solid var(--paper-dark)',
                boxShadow: isActive
                  ? '0 0 6px rgba(10,132,255,0.4)'
                  : isPublished
                    ? '0 0 6px rgba(48,209,88,0.3)'
                    : 'none',
              }}
            />
            <div
              className="font-medium"
              style={{ color: isFirst ? 'var(--ink)' : 'var(--ink-light)', fontSize: 'var(--text-xs)', marginBottom: 3 }}
            >
              {title}
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {entry.commitHash.slice(0, 8)}
              </span>
              <span>· {formatCommitTime(entry.committedAt)}</span>
              {isPublished && (
                <span
                  className="rounded px-1.5 py-[1px] font-semibold"
                  style={{ background: 'rgba(48,209,88,0.12)', color: 'var(--mark-green)', fontSize: '0.5625rem' }}
                >
                  已发布
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
