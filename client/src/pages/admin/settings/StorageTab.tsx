/*
 * StorageTab — 存储 tab
 *
 * 1. 本地仓库诊断（只读）
 * 2. 数据管理（一键清空 / 归档清空）
 *
 * 自包含：组件内部独立 loadData，不依赖父组件传入数据或回调。
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { StorageStatus } from '@/services/settings';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  PageHeader,
  Section,
  SectionSkeleton,
  StatusRow,
  ConnectionDot,
  Divider,
  DangerButton,
  SecondaryButton,
} from './SettingsUI';

export function StorageTab() {
  const confirm = useConfirm();

  // ─── 内部数据状态 ───

  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [clearing, setClearing] = useState(false);

  // 拉取存储状态，失败静默处理
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
      ? '将归档后清空所有本地数据（MongoDB + Git 内容）。归档文件保留在服务器磁盘上。'
      : '将直接清空所有本地数据（MongoDB + Git 内容），不可恢复。';
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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader>存储</PageHeader>
        <SectionSkeleton title="本地仓库诊断" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>存储</PageHeader>

      <Section
        title="本地仓库诊断"
        description={lastRefresh ? `最近检测：${lastRefresh.toLocaleTimeString('zh-CN')}` : undefined}
      >
        <div className="space-y-4">
          {/* OSS */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ConnectionDot connected={oss?.connected ?? false} />
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--ink-faded)' }}
              >
                OSS 对象存储
              </span>
            </div>
            <div className="space-y-1.5">
              <StatusRow label="Region" value={oss?.region || '—'} />
              <StatusRow label="Bucket" value={oss?.bucket || '—'} />
            </div>
          </div>

          <Divider />

          {/* Git */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ConnectionDot connected={!!git} />
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--ink-faded)' }}
              >
                Git 仓库
              </span>
            </div>
            {git ? (
              <div className="space-y-1.5">
                <StatusRow label="分支" value={git.branch} />
                <StatusRow label="总提交" value={`${git.totalCommits} 次`} />
                {git.lastCommitMessage && (
                  <StatusRow label="最近提交" value={git.lastCommitMessage} />
                )}
                {git.lastCommitTime && (
                  <StatusRow
                    label="提交时间"
                    value={new Date(git.lastCommitTime).toLocaleString('zh-CN')}
                  />
                )}
              </div>
            ) : (
              <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
                未检测到 Git 仓库
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* 数据管理 */}
      <Section title="数据管理">
        <div className="flex items-center gap-2">
          <SecondaryButton
            onClick={() => void handleClear(true)}
            disabled={clearing}
          >
            {clearing ? '处理中...' : '归档并清空'}
          </SecondaryButton>
          <DangerButton
            onClick={() => void handleClear(false)}
            disabled={clearing}
          >
            直接清空
          </DangerButton>
        </div>
        <p
          className="mt-2 text-xs"
          style={{ color: 'var(--ink-ghost)' }}
        >
          清空 MongoDB 全部内容 + Git 仓库文件。归档会先导出到服务器磁盘。
        </p>
      </Section>
    </div>
  );
}
