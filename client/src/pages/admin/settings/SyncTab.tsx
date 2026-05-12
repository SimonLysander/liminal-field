/*
 * SyncTab — 同步 tab
 *
 * 三个区块：
 * 1. 远端仓库配置（编辑/只读模式）
 * 2. 数据同步操作（推送/恢复）
 * 3. Git 提交配置（编辑/只读模式）
 */

import { useState, useCallback } from 'react';
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
} from './SettingsUI';

interface SyncTabProps {
  config: SettingsConfigView['sync'] | null;
  status: SettingsStatus | null;
  storageStatus: StorageStatus | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function SyncTab({ config, status, storageStatus, loading, onRefresh }: SyncTabProps) {
  const confirm = useConfirm();

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
      await onRefresh();
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
      await onRefresh();
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingGit(false);
    }
  };

  // ─── 同步操作 ───

  const [pushing, setPushing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const busy = pushing || syncing;

  const isConfigured = status?.remote.configured ?? false;
  const isConnected = status?.remote.connected ?? false;
  const remoteIsEmpty = status?.remote.isEmpty ?? null;
  const localIsEmpty = (status?.local.contentCount ?? 0) === 0;
  const hasUnpushed = (storageStatus?.git?.unpushedCommits ?? 0) > 0;
  const canPush = isConnected && hasUnpushed;
  const canSync = isConnected && remoteIsEmpty === false;

  const handlePush = async () => {
    const unpushedCount = storageStatus?.git?.unpushedCommits ?? 0;
    const ok = await confirm({
      title: '推送到远端',
      message: `将推送 ${unpushedCount} 个本地提交到远端仓库。`,
      confirmLabel: '确认推送',
    });
    if (!ok) return;
    setPushing(true);
    try {
      const result = await settingsApi.pushToRemote();
      if (result.success) banner.success(result.message);
      else banner.error(result.message);
      await onRefresh();
    } catch {
      banner.error('推送失败');
    } finally {
      setPushing(false);
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
      await onRefresh();
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
      <Section title="数据同步">
        {!isConfigured ? (
          <Hint>请先配置远端仓库</Hint>
        ) : !isConnected ? (
          <Hint warning>远端连接失败，请检查配置</Hint>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {storageStatus?.git && (
                <StatusRow
                  label="同步分支"
                  value={storageStatus.git.branch}
                />
              )}
              <StatusRow
                label="本地内容"
                value={localIsEmpty ? '空' : `${status!.local.contentCount} 个内容项`}
              />
              <StatusRow
                label="远端状态"
                value={remoteIsEmpty ? '空仓库' : '有数据'}
              />
              {storageStatus?.git && storageStatus.git.unpushedCommits > 0 && (
                <StatusRow
                  label="同步状态"
                  value={`${storageStatus.git.unpushedCommits} 个提交待推送`}
                  highlight
                />
              )}
              {storageStatus?.git && storageStatus.git.unpushedCommits === 0 && !remoteIsEmpty && (
                <StatusRow label="同步状态" value="已同步" />
              )}
            </div>
            <div className="space-y-3 pt-1">
              <SyncAction
                title="推送到远端"
                description={hasUnpushed ? `${storageStatus!.git!.unpushedCommits} 个提交待推送` : '已是最新'}
                buttonLabel={pushing ? '推送中...' : '推送'}
                onClick={() => void handlePush()}
                disabled={busy || !canPush}
                disabledReason={!canPush && !hasUnpushed ? '没有待推送的提交' : undefined}
              />
              <Divider />
              <SyncAction
                title="从远端恢复"
                description={localIsEmpty ? '从远端拉取数据恢复到本地' : '归档本地数据后，从远端重新恢复'}
                buttonLabel={syncing ? '恢复中...' : '恢复'}
                onClick={() => void handleSync()}
                disabled={busy || !canSync}
                disabledReason={!canSync && remoteIsEmpty === true ? '远端为空' : undefined}
                danger
              />
            </div>
          </div>
        )}
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
              <TextInput value={gitName} onChange={setGitName} placeholder="Liminal Field" />
            </div>
            <div>
              <FieldLabel>提交者邮箱</FieldLabel>
              <TextInput value={gitEmail} onChange={setGitEmail} placeholder="no-reply@liminal-field.local" />
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
