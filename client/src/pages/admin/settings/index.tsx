/*
 * SettingsPage — 系统设置页
 *
 * 布局：全高滚动容器，三个设置卡片纵向堆叠：
 *   1. 知识库远端配置（Remote URL + PAT 验证/保存）
 *   2. 同步状态（Git 状态 + 推送操作）
 *   3. 数据恢复（扫描仓库 + 执行恢复）
 *
 * 无动画——设置页是工具页，追求清晰务实，不加视觉噪声。
 */

import { useState, useEffect } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { SettingsStatus, ScanResult } from '@/services/settings';
import { authApi } from '@/services/auth';
import Topbar from '@/components/global/Topbar';
import { useConfirm } from '@/contexts/ConfirmContext';

// 同步状态类型，从 authApi 返回值中推导
type SyncStatus = Awaited<ReturnType<typeof authApi.syncStatus>>;

// ─── 主组件 ───

export default function SettingsPage() {
  const confirm = useConfirm();

  // 知识库状态
  const [status, setStatus] = useState<SettingsStatus | null>(null);

  // 同步状态（Git 仓库信息）
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(null);

  // 扫描结果
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // 远端配置输入
  const [remoteUrl, setRemoteUrl] = useState('');
  const [token, setToken] = useState('');

  // 验证状态
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  // 操作进行中状态
  const [scanning, setScanning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [saving, setSaving] = useState(false);

  // ─── 挂载时并行加载状态 + 同步信息 ───

  useEffect(() => {
    void Promise.all([
      settingsApi.getStatus().then(setStatus).catch(() => null),
      authApi.syncStatus().then((s) => {
        setSyncStatus(s);
        // 用远端 remote 字段预填 URL（remote 格式如 https://github.com/xxx/yyy）
        if (s?.remote) setRemoteUrl(s.remote);
      }).catch(() => null),
    ]);
  }, []);

  // ─── 验证远端连接 ───

  const handleValidate = async () => {
    if (!remoteUrl.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await settingsApi.validateRemote(remoteUrl.trim(), token.trim() || undefined);
      setValidationResult(result);
    } catch {
      setValidationResult({ valid: false, message: '验证请求失败，请检查网络' });
    } finally {
      setValidating(false);
    }
  };

  // ─── 保存远端配置 ───

  const handleSaveRemote = async () => {
    if (!remoteUrl.trim()) return;
    setSaving(true);
    try {
      await settingsApi.saveRemote(remoteUrl.trim(), token.trim() || undefined);
      // 保存成功（验证结果区域更新即为反馈）
    } catch {
      banner.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // ─── 推送到远端 ───

  const handlePush = async () => {
    setPushing(true);
    try {
      const result = await authApi.sync();
      if (result.success) {
        // 推送成功（刷新同步状态即为反馈）
        const updated = await authApi.syncStatus().catch(() => null);
        setSyncStatus(updated);
      } else {
        banner.error(result.message);
      }
    } catch {
      banner.error('推送失败，请重试');
    } finally {
      setPushing(false);
    }
  };

  // ─── 扫描仓库 ───

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await settingsApi.scan();
      setScanResult(result);
    } catch {
      banner.error('扫描失败，请重试');
    } finally {
      setScanning(false);
    }
  };

  // ─── 执行恢复 ───

  const handleRecover = async () => {
    if (!scanResult || scanResult.missingInDb.length === 0) return;

    const count = scanResult.missingInDb.length;
    const ok = await confirm({
      title: '确认恢复',
      message: `将从 Git 仓库恢复 ${count} 个缺失的内容项到数据库，是否继续？`,
      confirmLabel: '恢复',
    });
    if (!ok) return;

    setRecovering(true);
    try {
      const result = await settingsApi.execute(scanResult.missingInDb);
      if (result.errors.length > 0) {
        banner.error(`${result.errors.length} 个项目恢复失败`);
      }
      // 恢复成功后刷新状态 + 重置扫描结果（数量变化即为反馈）
      setScanResult(null);
      const updated = await settingsApi.getStatus().catch(() => null);
      setStatus(updated);
    } catch {
      banner.error('恢复失败，请重试');
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
      <Topbar />

      {/* 主内容区：纵向滚动，与其他管理页保持相同的 padding */}
      <div className="flex flex-1 flex-col overflow-y-auto px-10 py-9">
        <div className="mx-auto w-full max-w-2xl space-y-6">

          {/* ── Section 1：知识库远端配置 ── */}
          <SettingsCard>
            <SectionHeader>知识库远端配置</SectionHeader>

            <div className="space-y-3">
              {/* Remote URL */}
              <div>
                <FieldLabel>远端地址</FieldLabel>
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => {
                    setRemoteUrl(e.target.value);
                    // 输入变化后清除旧的验证结果
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

              {/* PAT */}
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

              {/* 验证结果内联展示 */}
              {validationResult && (
                <div
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: validationResult.valid
                      ? 'color-mix(in srgb, var(--mark-green) 12%, transparent)'
                      : 'color-mix(in srgb, var(--mark-red) 12%, transparent)',
                    color: validationResult.valid ? 'var(--mark-green)' : 'var(--mark-red)',
                    border: `1px solid ${validationResult.valid ? 'color-mix(in srgb, var(--mark-green) 25%, transparent)' : 'color-mix(in srgb, var(--mark-red) 25%, transparent)'}`,
                  }}
                >
                  {validationResult.valid ? '✓ ' : '✗ '}{validationResult.message}
                </div>
              )}

              {/* 操作按钮 */}
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

          {/* ── Section 2：同步状态 ── */}
          <SettingsCard>
            <SectionHeader>同步状态</SectionHeader>

            {syncStatus === null ? (
              // null 表示未配置 Git 仓库或加载失败
              <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
                未检测到 Git 仓库配置
              </p>
            ) : (
              <div className="space-y-3">
                {/* 状态行列表 */}
                <div className="space-y-2">
                  <StatusRow label="分支" value={syncStatus.branch} />
                  <StatusRow label="总提交" value={`${syncStatus.totalCommits} 次`} />
                  <StatusRow
                    label="待推送"
                    value={syncStatus.unpushedCommits > 0
                      ? `${syncStatus.unpushedCommits} 个提交`
                      : '已是最新'}
                    highlight={syncStatus.unpushedCommits > 0}
                  />
                  {syncStatus.lastCommitMessage && (
                    <StatusRow label="最近提交" value={syncStatus.lastCommitMessage} truncate />
                  )}
                  {syncStatus.lastCommitTime && (
                    <StatusRow
                      label="提交时间"
                      value={new Date(syncStatus.lastCommitTime).toLocaleString('zh-CN')}
                    />
                  )}
                </div>

                {/* 推送按钮：没有待推送提交时禁用 */}
                <div className="pt-1">
                  <PrimaryButton
                    onClick={() => void handlePush()}
                    disabled={pushing || syncStatus.unpushedCommits === 0}
                  >
                    {pushing ? '推送中...' : '推送到远端'}
                  </PrimaryButton>
                </div>
              </div>
            )}
          </SettingsCard>

          {/* ── Section 3：数据恢复 ── */}
          <SettingsCard>
            <SectionHeader>数据恢复</SectionHeader>

            {/* 当前状态概览 */}
            {status && (
              <div className="mb-4 space-y-2">
                <StatusRow label="数据库内容项" value={`${status.dbItemCount} 个`} />
                <StatusRow label="数据库快照" value={`${status.dbSnapshotCount} 个`} />
                <StatusRow label="Git 仓库内容项" value={`${status.gitItemCount} 个`} />
                <StatusRow
                  label="Manifest"
                  value={status.hasManifest ? '存在' : '缺失'}
                  highlight={!status.hasManifest}
                />
              </div>
            )}

            {/* 扫描结果 */}
            {scanResult && (
              <div
                className="mb-4 rounded-lg p-3"
                style={{
                  background: 'var(--shelf)',
                  border: '1px solid var(--separator)',
                }}
              >
                <div className="space-y-1.5">
                  <div className="text-xs" style={{ color: 'var(--ink-faded)' }}>
                    Git 仓库：<span style={{ color: 'var(--ink)' }}>{scanResult.gitItems.length} 个内容项</span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--ink-faded)' }}>
                    数据库：<span style={{ color: 'var(--ink)' }}>{scanResult.dbItems.length} 个内容项</span>
                  </div>

                  {scanResult.missingInDb.length > 0 ? (
                    <>
                      <div
                        className="mt-2 text-xs font-medium"
                        style={{ color: 'var(--mark-red)' }}
                      >
                        发现 {scanResult.missingInDb.length} 个缺失项
                      </div>
                      {/* 缺失 contentId 列表 */}
                      <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                        {scanResult.missingInDb.map((id) => (
                          <div
                            key={id}
                            className="font-mono text-xs"
                            style={{ color: 'var(--ink-faded)' }}
                          >
                            {id}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div
                      className="mt-2 text-xs font-medium"
                      style={{ color: 'var(--mark-green)' }}
                    >
                      ✓ 数据库与 Git 仓库一致，无缺失项
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <SecondaryButton onClick={() => void handleScan()} disabled={scanning}>
                {scanning ? '扫描中...' : '扫描仓库'}
              </SecondaryButton>

              {/* 仅在扫描后有缺失项时显示恢复按钮 */}
              {scanResult && scanResult.missingInDb.length > 0 && (
                <PrimaryButton onClick={() => void handleRecover()} disabled={recovering}>
                  {recovering ? '恢复中...' : `恢复 ${scanResult.missingInDb.length} 项`}
                </PrimaryButton>
              )}
            </div>
          </SettingsCard>

        </div>
      </div>
    </div>
  );
}

// ─── 原子组件 ───

/** 设置卡片容器 */
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

/** 区块标题：大写 + 字母间距，与其他管理页右栏 SectionTitle 风格一致 */
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

/** 表单字段标签 */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium" style={{ color: 'var(--ink-faded)' }}>
      {children}
    </div>
  );
}

/** 状态信息行：左标签 + 右值 */
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
      <span className="shrink-0 text-xs font-medium" style={{ color: 'var(--ink-ghost)' }}>
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

/** 主操作按钮：ink 背景 */
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

/** 次要操作按钮：轮廓样式 */
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
