/*
 * StorageTab — 存储 tab
 *
 * 纯只读：OSS 运行状态 + Git 仓库诊断。
 * OSS 配置走 docker-compose env，不提供 UI 编辑。
 */

import type { StorageStatus } from '@/services/settings';
import {
  PageHeader,
  Section,
  SectionSkeleton,
  StatusRow,
  ConnectionDot,
  Divider,
} from './SettingsUI';

interface StorageTabProps {
  storageStatus: StorageStatus | null;
  loading: boolean;
}

export function StorageTab({ storageStatus, loading }: StorageTabProps) {
  const git = storageStatus?.git;
  const oss = storageStatus?.oss;

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

      <Section title="本地仓库诊断">
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
                <StatusRow
                  label="总提交"
                  value={`${git.totalCommits} 次`}
                />
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
                className="text-xs"
                style={{ color: 'var(--ink-ghost)' }}
              >
                未检测到 Git 仓库
              </span>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
