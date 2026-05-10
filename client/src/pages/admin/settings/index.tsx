/*
 * SettingsPage — 系统设置页
 *
 * 三个区块：
 *   1. 远端仓库配置（URL + Token + 验证/保存）
 *   2. 数据同步（推送到远端 / 从远端同步 + 状态）
 *   3. 本地状态（DB / Git 数量概览）
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { SettingsStatus } from '@/services/settings';
import Topbar from '@/components/global/Topbar';
import { useConfirm } from '@/contexts/ConfirmContext';

type SyncStatus = Awaited<ReturnType<typeof settingsApi.getSyncStatus>>;

export default function SettingsPage() {
  const confirm = useConfirm();

  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [token, setToken] = useState('');

  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ─── 加载 ───

  const refresh = useCallback(() => {
    void Promise.all([
      settingsApi.getStatus().then(setStatus).catch(() => null),
      settingsApi.getSyncStatus().then((s) => {
        setSyncStatus(s);
        if (s?.remote) setRemoteUrl(s.remote);
      }).catch(() => null),
    ]);
  }, []);

  useEffect(refresh, [refresh]);

  // ─── 远端配置 ───

  const handleValidate = async () => {
    if (!remoteUrl.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await settingsApi.validateRemote(
        remoteUrl.trim(),
        token.trim() || undefined,
      );
      setValidationResult(result);
    } catch {
      setValidationResult({ valid: false, message: '验证请求失败' });
    } finally {
      setValidating(false);
    }
  };

  const handleSaveRemote = async () => {
    if (!remoteUrl.trim()) return;
    setSaving(true);
    try {
      await settingsApi.saveRemote(
        remoteUrl.trim(),
        token.trim() || undefined,
      );
      banner.success('配置已保存（运行时生效，重启持久化需更新环境变量）');
      refresh();
    } catch {
      banner.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ─── 推送到远端 ───

  const handlePush = async () => {
    setPushing(true);
    try {
      const result = await settingsApi.pushToRemote();
      if (result.success) {
        banner.success(result.message);
      } else {
        banner.error(result.message);
      }
      refresh();
    } catch {
      banner.error('推送失败');
    } finally {
      setPushing(false);
    }
  };

  // ─── 从远端同步 ───

  const handleSyncFromRemote = async () => {
    const ok = await confirm({
      title: '从远端同步',
      message:
        '将清空所有本地数据（数据库 + 仓库内容）并从远端重新拉取，此操作不可恢复。是否继续？',
      confirmLabel: '确认同步',
    });
    if (!ok) return;

    setSyncing(true);
    try {
      const result = await settingsApi.syncFromRemote();
      if (result.success) {
        banner.success(result.message);
      } else {
        banner.error(result.errors[0] || result.message);
      }
      refresh();
    } catch {
      banner.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const busy = pushing || syncing;

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ background: 'var(--paper)' }}
    >
      <Topbar />
      <div className="flex flex-1 flex-col overflow-y-auto px-10 py-9">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          {/* ── 区块 1：远端仓库配置 ── */}
          <SettingsCard>
            <SectionHeader>远端仓库配置</SectionHeader>
            <div className="space-y-3">
              <div>
                <FieldLabel>远端地址</FieldLabel>
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => {
                    setRemoteUrl(e.target.value);
                    setValidationResult(null);
                  }}
                  placeholder="https://github.com/yourname/kb.git"
                  className="mt-1 h-9 w-full rounded-lg px-3 text-sm outline-none"
                  style={{
                    background: 'var(--shelf)',
                    color: 'var(--ink)',
                    border: '1px solid var(--separator)',
                  }}
                />
              </div>
              <div>
                <FieldLabel>访问令牌（PAT）</FieldLabel>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setValidationResult(null);
                  }}
                  placeholder="可选，私有仓库需要"
                  className="mt-1 h-9 w-full rounded-lg px-3 text-sm outline-none"
                  style={{
                    background: 'var(--shelf)',
                    color: 'var(--ink)',
                    border: '1px solid var(--separator)',
                  }}
                />
              </div>
              {validationResult && (
                <div
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: validationResult.valid
                      ? 'color-mix(in srgb, var(--mark-green) 12%, transparent)'
                      : 'color-mix(in srgb, var(--mark-red) 12%, transparent)',
                    color: validationResult.valid
                      ? 'var(--mark-green)'
                      : 'var(--mark-red)',
                    border: `1px solid ${validationResult.valid ? 'color-mix(in srgb, var(--mark-green) 25%, transparent)' : 'color-mix(in srgb, var(--mark-red) 25%, transparent)'}`,
                  }}
                >
                  {validationResult.valid ? '✓ ' : '✗ '}
                  {validationResult.message}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <SecondaryButton
                  onClick={() => void handleValidate()}
                  disabled={validating || !remoteUrl.trim()}
                >
                  {validating ? '验证中...' : '验证连接'}
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => void handleSaveRemote()}
                  disabled={saving || !remoteUrl.trim()}
                >
                  {saving ? '保存中...' : '保存配置'}
                </PrimaryButton>
              </div>
            </div>
          </SettingsCard>

          {/* ── 区块 2：数据同步 ── */}
          <SettingsCard>
            <SectionHeader>数据同步</SectionHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <PrimaryButton
                  onClick={() => void handlePush()}
                  disabled={busy}
                >
                  {pushing ? '推送中...' : '推送到远端'}
                </PrimaryButton>
                <SecondaryButton
                  onClick={() => void handleSyncFromRemote()}
                  disabled={busy}
                >
                  {syncing ? '同步中...' : '从远端同步'}
                </SecondaryButton>
              </div>
              {syncStatus && (
                <div className="space-y-2 pt-1">
                  <StatusRow label="分支" value={syncStatus.branch} />
                  <StatusRow
                    label="总提交"
                    value={`${syncStatus.totalCommits} 次`}
                  />
                  <StatusRow
                    label="待推送"
                    value={
                      syncStatus.unpushedCommits > 0
                        ? `${syncStatus.unpushedCommits} 个提交`
                        : '已是最新'
                    }
                    highlight={syncStatus.unpushedCommits > 0}
                  />
                  {syncStatus.lastCommitMessage && (
                    <StatusRow
                      label="最近提交"
                      value={syncStatus.lastCommitMessage}
                      truncate
                    />
                  )}
                </div>
              )}
              {!syncStatus && (
                <p
                  className="text-sm"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  未检测到 Git 仓库
                </p>
              )}
            </div>
          </SettingsCard>

          {/* ── 区块 3：本地状态 ── */}
          {status && (
            <SettingsCard>
              <SectionHeader>本地状态</SectionHeader>
              <div className="space-y-2">
                <StatusRow
                  label="数据库内容项"
                  value={`${status.dbItemCount} 个`}
                />
                <StatusRow
                  label="数据库快照"
                  value={`${status.dbSnapshotCount} 个`}
                />
                <StatusRow
                  label="Git 仓库内容项"
                  value={`${status.gitItemCount} 个`}
                />
                <StatusRow
                  label="Manifest"
                  value={status.hasManifest ? '存在' : '缺失'}
                  highlight={!status.hasManifest}
                />
              </div>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 原子组件 ───

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="p-6"
      style={{
        background: 'var(--paper-dark)',
        borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-4 text-xs font-semibold uppercase tracking-widest"
      style={{ color: 'var(--ink-ghost)' }}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium" style={{ color: 'var(--ink-faded)' }}>
      {children}
    </div>
  );
}

function StatusRow({
  label,
  value,
  highlight,
  truncate,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {label}
      </span>
      <span
        className={`text-right text-sm ${truncate ? 'max-w-xs truncate' : ''}`}
        style={{ color: highlight ? 'var(--mark-red)' : 'var(--ink-faded)' }}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-lg px-4 text-sm font-medium transition-opacity duration-150 disabled:opacity-40"
      style={{ background: 'var(--ink)', color: 'var(--paper)' }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-lg px-4 text-sm font-medium transition-opacity duration-150 disabled:opacity-40"
      style={{
        background: 'var(--shelf)',
        color: 'var(--ink-faded)',
        border: '1px solid var(--separator)',
      }}
    >
      {children}
    </button>
  );
}
