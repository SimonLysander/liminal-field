/*
 * SyncTab — 同步 tab
 *
 * 三个区块：
 * 1. 远端仓库配置（编辑/只读模式）
 * 2. 数据同步操作（推送/恢复）
 * 3. Git 提交配置（编辑/只读模式）
 *
 * 自包含：组件内部独立 loadData，不依赖父组件传入数据或回调。
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { SettingsConfigView, SettingsStatus, StorageStatus } from '@/services/settings';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  PageHeader,
  Section,
  EditableSection,
  SectionSkeleton,
  FieldLabel,
  TextInput,
  CronSelect,
  StatusRow,
  ConnectionDot,
  Hint,
  Divider,
  ValidationBanner,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  Toggle,
} from './SettingsUI';

export function SyncTab() {
  const confirm = useConfirm();

  // ─── 内部数据状态 ───

  const [config, setConfig] = useState<SettingsConfigView['sync'] | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 并行拉取 config、status、storageStatus，失败静默处理
  const loadData = useCallback(async () => {
    const [c, s, ss] = await Promise.all([
      settingsApi.getConfig().catch(() => null),
      settingsApi.getStatus().catch(() => null),
      settingsApi.getStorageStatus().catch(() => null),
    ]);
    setConfig(c?.sync ?? null);
    setStatus(s);
    setStorageStatus(ss);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  // ─── 远端配置 ───

  const [remoteEditing, setRemoteEditing] = useState(false);
  const [formUrl, setFormUrl] = useState(config?.remoteUrl ?? '');
  const [formToken, setFormToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);

  const resetRemoteForm = useCallback(() => {
    setFormUrl(config?.remoteUrl ?? '');
    setFormToken('');
    setValidationResult(null);
    setRemoteEditing(false);
  }, [config]);

  const handleValidate = async () => {
    if (!formUrl.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await settingsApi.validateRemote(
        formUrl.trim(),
        formToken.trim() || undefined,
      );
      setValidationResult(result);
    } catch {
      setValidationResult({ valid: false, message: '验证请求失败' });
    } finally {
      setValidating(false);
    }
  };

  const handleSaveRemote = async () => {
    if (!formUrl.trim()) return;
    setSavingRemote(true);
    try {
      await settingsApi.saveSyncConfig({
        url: formUrl.trim(),
        token: formToken.trim() || undefined,
      });
      banner.success('远端配置已保存');
      setRemoteEditing(false);
      setValidationResult(null);
      setFormToken('');
      await loadData();
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingRemote(false);
    }
  };

  // ─── Git 配置 ───

  const [gitEditing, setGitEditing] = useState(false);
  const [gitName, setGitName] = useState(config?.gitAuthorName ?? '');
  const [gitEmail, setGitEmail] = useState(config?.gitAuthorEmail ?? '');
  const [gitCron, setGitCron] = useState(config?.gitSyncCron ?? '');
  const [savingGit, setSavingGit] = useState(false);

  const resetGitForm = useCallback(() => {
    setGitName(config?.gitAuthorName ?? '');
    setGitEmail(config?.gitAuthorEmail ?? '');
    setGitCron(config?.gitSyncCron ?? '');
    setGitEditing(false);
  }, [config]);

  const handleSaveGit = async () => {
    setSavingGit(true);
    try {
      await settingsApi.saveSyncConfig({
        url: config?.remoteUrl ?? '',
        gitAuthorName: gitName.trim(),
        gitAuthorEmail: gitEmail.trim(),
        gitSyncCron: gitCron.trim(),
      });
      banner.success('Git 配置已保存');
      setGitEditing(false);
      await loadData();
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingGit(false);
    }
  };

  // ─── 同步操作 ───

  const [pushing, setPushing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [publishingAll, setPublishingAll] = useState(false);
  const [togglingSync, setTogglingSync] = useState(false);
  const busy = pushing || syncing || publishingAll;

  const isConfigured = !!config?.remoteUrl;
  /** 同步开关:关闭时即使配了远端也不 push(默认开启) */
  const syncEnabled = config?.gitSyncEnabled ?? true;

  /** 切换同步开关:只改 gitSyncEnabled,remoteUrl 保持当前值不动 */
  const handleToggleSync = async (enabled: boolean) => {
    setTogglingSync(true);
    try {
      await settingsApi.saveSyncConfig({ url: config?.remoteUrl ?? '', gitSyncEnabled: enabled });
      banner.success(enabled ? '已开启同步' : '已关闭同步');
      await loadData();
    } catch {
      banner.error('保存失败');
    } finally {
      setTogglingSync(false);
    }
  };
  const localIsEmpty = (status?.local.contentCount ?? 0) === 0;
  const syncState = storageStatus?.git?.syncState ?? 'no_remote';
  const unpushedCount = storageStatus?.git?.unpushedCommits ?? 0;
  const isConnected = !['no_remote', 'no_repo'].includes(syncState)
    || (syncState === 'no_repo' && isConfigured);  // no_repo 但配置了远端 → 可能远端有数据

  // 推送：本地领先 或 远端为空时
  const canPush = syncState === 'ahead' || syncState === 'remote_empty';
  // 恢复：远端有数据时（behind/diverged/no_repo 有远端/synced 但 DB 空）
  const canSync =
    syncState === 'behind' ||
    syncState === 'diverged' ||
    (localIsEmpty && syncState === 'synced');

  const handlePush = async () => {
    const msg = syncState === 'remote_empty'
      ? '首次推送，将本地数据推送到空远端仓库。'
      : `将推送 ${unpushedCount} 个本地提交到远端仓库。`;
    const ok = await confirm({
      title: '推送到远端',
      message: msg,
      confirmLabel: '确认推送',
    });
    if (!ok) return;
    setPushing(true);
    try {
      const result = await settingsApi.pushToRemote();
      if (result.success) banner.success(result.message);
      else banner.error(result.message);
      await loadData();
    } catch {
      banner.error('推送失败');
    } finally {
      setPushing(false);
    }
  };

  // 一键发布全部最新版(本地操作,不依赖远端;常用于恢复后重新上线)
  const handlePublishAll = async () => {
    const ok = await confirm({
      title: '发布全部最新版',
      message:
        '把所有内容（笔记 / 画廊 / 文集条目）的最新提交版本一键上线。常用于从远端恢复后重新上线。',
      confirmLabel: '确认发布',
    });
    if (!ok) return;
    setPublishingAll(true);
    try {
      const result = await settingsApi.publishAll();
      banner.success(
        `已发布 ${result.published} 项${result.skipped ? `，跳过 ${result.skipped} 项` : ''}`,
      );
      await loadData();
    } catch {
      banner.error('发布失败');
    } finally {
      setPublishingAll(false);
    }
  };

  const handleSync = async () => {
    const hasLocalData = !localIsEmpty;
    const ok = await confirm({
      title: '从远端恢复',
      message: hasLocalData
        ? '将归档本地数据后清空，再从远端恢复。归档文件保留在服务器磁盘上。'
        : '将从远端拉取数据并恢复到本地。',
      confirmLabel: '确认恢复',
      danger: hasLocalData,
    });
    if (!ok) return;
    setSyncing(true);
    try {
      const result = await settingsApi.syncFromRemote();
      if (result.success) {
        const note = result.archived ? '（已归档旧数据）' : '';
        banner.success(`${result.message}${note}`);
      } else {
        banner.error(result.message);
      }
      await loadData();
    } catch {
      banner.error('恢复失败');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader>同步</PageHeader>
        <SectionSkeleton title="远端仓库" />
        <SectionSkeleton title="数据同步" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>同步</PageHeader>

      {/* ── 远端仓库 ── */}
      <EditableSection
        title="远端仓库"
        editing={remoteEditing}
        onEdit={() => {
          setFormUrl(config?.remoteUrl ?? '');
          setFormToken('');
          setValidationResult(null);
          setRemoteEditing(true);
        }}
        onSave={() => void handleSaveRemote()}
        onReset={resetRemoteForm}
        saving={savingRemote}
        canSave={!!formUrl.trim()}
        viewContent={
          config?.remoteUrl ? (
            <div className="space-y-2">
              <StatusRow label="地址" value={config.remoteUrl} />
              <div className="flex items-center gap-2">
                <ConnectionDot connected={isConnected} />
                <span
                  className="text-xs"
                  style={{ color: isConnected ? 'var(--mark-green)' : 'var(--mark-red)' }}
                >
                  {isConnected ? '已连接' : '连接失败'}
                </span>
                {config.hasToken && (
                  <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
                    · 令牌已配置
                  </span>
                )}
              </div>
            </div>
          ) : (
            <Hint>未配置</Hint>
          )
        }
        editContent={
          <div className="space-y-3">
            <div>
              <FieldLabel>远端地址</FieldLabel>
              <TextInput
                value={formUrl}
                onChange={(v) => { setFormUrl(v); setValidationResult(null); }}
                placeholder="https://github.com/yourname/kb.git"
              />
            </div>
            <div>
              <FieldLabel>
                访问令牌（PAT）
                {config?.hasToken && !formToken && (
                  <span className="ml-2 font-normal" style={{ color: 'var(--ink-ghost)' }}>
                    已配置，留空则不修改
                  </span>
                )}
              </FieldLabel>
              <TextInput
                value={formToken}
                onChange={(v) => { setFormToken(v); setValidationResult(null); }}
                placeholder="可选，私有仓库需要"
                type="password"
              />
            </div>
            {validationResult && <ValidationBanner result={validationResult} />}
            <div className="pt-1">
              <SecondaryButton
                onClick={() => void handleValidate()}
                disabled={validating || !formUrl.trim()}
              >
                {validating ? '验证中...' : '验证连接'}
              </SecondaryButton>
            </div>
          </div>
        }
      />

      {/* ── 数据同步 ── */}
      <Section
        title="数据同步"
        description={lastRefresh ? `最近检测：${lastRefresh.toLocaleTimeString('zh-CN')}` : undefined}
      >
        {!isConfigured && syncState !== 'no_repo' ? (
          <Hint>请先配置远端仓库</Hint>
        ) : syncState === 'no_remote' ? (
          <Hint warning>远端连接失败，请检查配置</Hint>
        ) : (
          <div className="space-y-4">
            {/* 同步总开关:关闭时即使配了远端也不 push(自动 cron / 月度归档 / 手动推送都跳过) */}
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  同步到远端
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                  {syncEnabled ? '已开启：内容会按计划推送到远端' : '已关闭：即使配了远端也不会推送'}
                </div>
              </div>
              <Toggle
                checked={syncEnabled}
                onChange={(v) => void handleToggleSync(v)}
                disabled={togglingSync}
              />
            </div>
            <Divider />
            <div className="space-y-2">
              <StatusRow
                label="本地仓库"
                value={syncState === 'no_repo' ? '不存在' : '正常'}
                highlight={syncState === 'no_repo'}
              />
              {storageStatus?.git?.branch && (
                <StatusRow label="同步分支" value={storageStatus.git.branch} />
              )}
              <StatusRow
                label="本地内容"
                value={localIsEmpty ? '空' : `${status!.local.contentCount} 个内容项`}
              />
              <SyncStateRow syncState={syncState} unpushedCount={unpushedCount} localIsEmpty={localIsEmpty} />
            </div>
            <div className="space-y-3 pt-1">
              <SyncAction
                title="推送到远端"
                description={
                  syncState === 'ahead'
                    ? `${unpushedCount} 个提交待推送`
                    : syncState === 'remote_empty'
                      ? '首次推送到空仓库'
                      : syncState === 'diverged'
                        ? '历史不一致，无法推送'
                        : '已是最新'
                }
                buttonLabel={pushing ? '推送中...' : '推送'}
                onClick={() => void handlePush()}
                disabled={busy || !canPush || !syncEnabled}
                disabledReason={
                  !syncEnabled
                    ? '同步已关闭'
                    : syncState === 'diverged'
                      ? '本地与远端历史不一致'
                      : undefined
                }
              />
              <Divider />
              <SyncAction
                title="从远端恢复"
                description={
                  syncState === 'diverged'
                    ? '本地与远端历史不一致，恢复将覆盖本地数据'
                    : localIsEmpty
                      ? '从远端拉取数据恢复到本地'
                      : '归档本地数据后，从远端重新恢复'
                }
                buttonLabel={syncing ? '恢复中...' : '恢复'}
                onClick={() => void handleSync()}
                disabled={busy || !canSync}
                disabledReason={
                  syncState === 'remote_empty' ? '远端为空' :
                  syncState === 'synced' ? '已同步，无需恢复' :
                  syncState === 'ahead' ? '本地领先，无需恢复' : undefined
                }
                danger={canSync}
              />
            </div>
          </div>
        )}
      </Section>

      {/* ── 内容发布（本地操作,不依赖远端;恢复后一键重新上线） ── */}
      <Section
        title="内容发布"
        description="发布状态不进 Git，从远端恢复后所有内容默认未发布"
      >
        <SyncAction
          title="发布全部最新版"
          description="把所有内容（笔记 / 画廊 / 文集条目）的最新提交版本一键上线"
          buttonLabel={publishingAll ? '发布中...' : '发布全部'}
          onClick={() => void handlePublishAll()}
          disabled={busy}
        />
      </Section>

      {/* ── Git 配置（仅配置了远端时展示） ── */}
      {isConfigured && <EditableSection
        title="Git 提交配置"
        description="内容提交时使用的署名信息和自动同步频率"
        editing={gitEditing}
        onEdit={() => {
          setGitName(config?.gitAuthorName ?? '');
          setGitEmail(config?.gitAuthorEmail ?? '');
          setGitCron(config?.gitSyncCron ?? '');
          setGitEditing(true);
        }}
        onSave={() => void handleSaveGit()}
        onReset={resetGitForm}
        saving={savingGit}
        viewContent={
          <div className="space-y-2">
            <StatusRow label="提交者" value={config?.gitAuthorName || '默认'} />
            <StatusRow label="邮箱" value={config?.gitAuthorEmail || '默认'} />
            <StatusRow label="自动同步" value={config?.gitSyncCron || '0 3 * * *'} />
          </div>
        }
        editContent={
          <div className="space-y-3">
            <div>
              <FieldLabel>提交者名称</FieldLabel>
              <TextInput value={gitName} onChange={setGitName} placeholder="Lux Stirring" />
            </div>
            <div>
              <FieldLabel>提交者邮箱</FieldLabel>
              <TextInput value={gitEmail} onChange={setGitEmail} placeholder="no-reply@lux-stirring.local" />
            </div>
            <div>
              <FieldLabel>自动同步频率</FieldLabel>
              <CronSelect value={gitCron} onChange={setGitCron} />
            </div>
          </div>
        }
      />}
    </div>
  );
}

const SYNC_STATE_DISPLAY: Record<string, { text: string; highlight?: boolean }> = {
  no_repo: { text: '本地仓库不存在' },
  no_remote: { text: '未配置远端' },
  remote_empty: { text: '远端为空，可推送' },
  synced: { text: '已同步' },
  synced_db_empty: { text: '数据库为空，可从仓库恢复', highlight: true },
  ahead: { text: '待推送', highlight: true },
  diverged: { text: '本地与远端历史不一致', highlight: true },
  behind: { text: '远端有数据，可恢复', highlight: true },
};

function SyncStateRow({
  syncState,
  unpushedCount,
  localIsEmpty,
}: {
  syncState: string;
  unpushedCount: number;
  localIsEmpty: boolean;
}) {
  // Git 同步但 MongoDB 为空 → 显示特殊状态
  const effectiveState =
    localIsEmpty && syncState === 'synced' ? 'synced_db_empty' : syncState;
  const display = SYNC_STATE_DISPLAY[effectiveState] ?? { text: effectiveState };
  const value =
    effectiveState === 'ahead' ? `${unpushedCount} 个提交待推送` : display.text;
  return (
    <StatusRow label="同步状态" value={value} highlight={display.highlight} />
  );
}

function SyncAction({
  title, description, buttonLabel, onClick, disabled, disabledReason, danger,
}: {
  title: string; description: string; buttonLabel: string;
  onClick: () => void; disabled?: boolean; disabledReason?: string; danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{title}</div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {disabledReason ?? description}
        </div>
      </div>
      {danger ? (
        <DangerButton onClick={onClick} disabled={disabled}>{buttonLabel}</DangerButton>
      ) : (
        <PrimaryButton onClick={onClick} disabled={disabled}>{buttonLabel}</PrimaryButton>
      )}
    </div>
  );
}
