/*
 * StorageTab — 存储 tab(2026-05-31 按宪法重做)。
 *
 * 1. 本地仓库诊断(只读 status row,OSS + Git)
 * 2. 数据管理(归档清空 / 直接清空,danger)
 *
 * heading + divider 分段、ui/* 标准件、28px 紧凑。
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';
import type { StorageStatus } from '@/services/settings';
import { useConfirm } from '@/contexts/ConfirmContext';

/** 状态行:左 label(12px ghost) + 右 value(14 ink-faded);连接点可选 */
function StatusRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'success' | 'danger';
}) {
  const color =
    highlight === 'success'
      ? 'var(--success)'
      : highlight === 'danger'
        ? 'var(--danger)'
        : 'var(--ink-faded)';
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {label}
      </span>
      <span
        className="truncate text-md text-right"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

/** 连接点:绿色已连接 / 红色未连接 */
function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: connected ? 'var(--success)' : 'var(--danger)',
      }}
    />
  );
}

export function StorageTab() {
  const confirm = useConfirm();

  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadData = useCallback(async () => {
    const ss = await settingsApi.getStorageStatus().catch(() => null);
    setStorageStatus(ss);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const git = storageStatus?.git;
  const oss = storageStatus?.oss;

  const handleClear = async (archive: boolean) => {
    const msg = archive
      ? '将归档后清空所有本地数据(MongoDB + Git 内容)。归档文件保留在服务器磁盘上。'
      : '将直接清空所有本地数据(MongoDB + Git 内容),不可恢复。';
    const ok = await confirm({
      title: archive ? '归档并清空' : '清空本地数据',
      message: msg,
      confirmLabel: archive ? '归档并清空' : '直接清空',
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      const result = await settingsApi.clearLocal(archive);
      if (result.success) {
        banner.success(result.message);
      } else {
        banner.error(result.message);
      }
      await loadData();
    } catch {
      banner.error('清空失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          存储
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          本地仓库诊断与数据管理
        </p>
      </div>
      <Separator />

      {/* ── 本地仓库诊断 ── */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            本地仓库诊断
          </h2>
          {lastRefresh && (
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              最近检测 {lastRefresh.toLocaleTimeString('zh-CN')}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            <div
              className="h-3 w-1/2 rounded-sm animate-pulse"
              style={{ background: 'var(--shelf)' }}
            />
            <div
              className="h-3 w-1/3 rounded-sm animate-pulse"
              style={{ background: 'var(--shelf)' }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {/* OSS */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ConnectionDot connected={oss?.connected ?? false} />
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--ink-faded)' }}
                >
                  OSS 对象存储
                </span>
              </div>
              <div className="space-y-1.5 pl-3.5">
                <StatusRow label="Region" value={oss?.region || '—'} />
                <StatusRow label="Bucket" value={oss?.bucket || '—'} />
              </div>
            </div>

            <Separator />

            {/* Git */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ConnectionDot connected={!!git} />
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--ink-faded)' }}
                >
                  Git 仓库
                </span>
              </div>
              {git ? (
                <div className="space-y-1.5 pl-3.5">
                  <StatusRow label="分支" value={git.branch} />
                  <StatusRow label="总提交" value={`${git.totalCommits} 次`} />
                  {git.lastCommitMessage && (
                    <StatusRow
                      label="最近提交"
                      value={git.lastCommitMessage}
                    />
                  )}
                  {git.lastCommitTime && (
                    <StatusRow
                      label="提交时间"
                      value={new Date(git.lastCommitTime).toLocaleString(
                        'zh-CN',
                      )}
                    />
                  )}
                </div>
              ) : (
                <span
                  className="pl-3.5 text-xs"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  未检测到 Git 仓库
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <Separator />

      {/* ── 数据管理 ── */}
      <section className="space-y-4">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            数据管理
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            清空 MongoDB 全部内容 + Git 仓库文件。归档会先导出到服务器磁盘。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleClear(true)}
            disabled={clearing}
          >
            {clearing ? '处理中…' : '归档并清空'}
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleClear(false)}
            disabled={clearing}
          >
            直接清空
          </Button>
        </div>
      </section>
    </div>
  );
}
