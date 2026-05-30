/*
 * SyncTab — 同步 tab(2026-05-31 按宪法重做)。
 *
 * 1. 远端仓库(URL + PAT + 验证连接)
 * 2. 数据同步(总开关 + 状态行 + 推送/恢复操作)
 * 3. 一键发布全部最新版
 * 4. Git 提交配置(署名 + 自动同步频率)
 *
 * heading + divider 分段、ui/* 标准件、28px 紧凑、accent 紫 / danger 红字。
 */

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/services/settings';
import type {
  SettingsConfigView,
  SettingsStatus,
  StorageStatus,
} from '@/services/settings';
import { useConfirm } from '@/contexts/ConfirmContext';

const CRON_PRESETS = [
  { value: '0 * * * *', label: '每小时' },
  { value: '0 */3 * * *', label: '每 3 小时' },
  { value: '0 */6 * * *', label: '每 6 小时' },
  { value: '0 */12 * * *', label: '每 12 小时' },
  { value: '0 0 * * *', label: '每天 0:00' },
  { value: '0 3 * * *', label: '每天 3:00' },
  { value: '0 3 * * 1', label: '每周一 3:00' },
];

/** 紧凑字段 atom */
function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="text-xs font-medium"
        style={{ color: 'var(--ink-faded)' }}
      >
        {label}
      </div>
      {children}
      {helper && (
        <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {helper}
        </div>
      )}
    </div>
  );
}

/** 密码 input — 可切换显示/隐藏 */
function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative max-w-md">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/** select 复用 input 紧凑样式(等待 ui/select 上线前的临时方案) */
function NativeSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-7 w-full max-w-md rounded-sm border border-transparent bg-[var(--shelf)] px-2.5 text-md transition-colors hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
      style={{ color: 'var(--ink)' }}
    >
      {children}
    </select>
  );
}

/** 状态行:左 label / 右 value */
function StatusRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'success' | 'danger' | 'warning';
}) {
  const color =
    highlight === 'success'
      ? 'var(--success)'
      : highlight === 'danger'
        ? 'var(--danger)'
        : highlight === 'warning'
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
      <span className="text-md text-right" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/** Toggle 复用 Owner 模板的纸墨开关(accent 紫轨,28px 紧凑) */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{
        background: checked
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--ink) 18%, transparent)',
      }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full transition-transform duration-200"
        style={{
          background: 'var(--paper-white)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </button>
  );
}

const SYNC_STATE_DISPLAY: Record<
  string,
  { text: string; highlight?: 'success' | 'danger' | 'warning' }
> = {
  no_repo: { text: '本地仓库不存在' },
  no_remote: { text: '未配置远端' },
  remote_empty: { text: '远端为空,可推送', highlight: 'warning' },
  synced: { text: '已同步', highlight: 'success' },
  synced_db_empty: { text: '数据库为空,可从仓库恢复', highlight: 'warning' },
  ahead: { text: '待推送', highlight: 'warning' },
  diverged: { text: '本地与远端历史不一致', highlight: 'danger' },
  behind: { text: '远端有数据,可恢复', highlight: 'warning' },
};

export function SyncTab() {
  const confirm = useConfirm();

  const [config, setConfig] = useState<SettingsConfigView['sync'] | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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
  const [formUrl, setFormUrl] = useState('');
  const [formToken, setFormToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);

  // config 加载后同步 form
  useEffect(() => {
    if (!config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- config 从外部 fetch 拿到后填表
    setFormUrl(config.remoteUrl ?? '');
  }, [config]);

  const remoteUrlDirty = formUrl.trim() !== (config?.remoteUrl ?? '').trim();
  const remoteTokenDirty = formToken.trim().length > 0;
  const remoteDirty = remoteUrlDirty || remoteTokenDirty;

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
      setFormToken('');
      setValidationResult(null);
      await loadData();
    } catch {
      banner.error('保存失败');
    } finally {
      setSavingRemote(false);
    }
  };

  // ─── Git 提交配置 ───
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [gitCron, setGitCron] = useState('');
  const [savingGit, setSavingGit] = useState(false);

  useEffect(() => {
    if (!config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- config 来自外部 fetch,非渲染期同步表单
    setGitName(config.gitAuthorName ?? '');
     
    setGitEmail(config.gitAuthorEmail ?? '');
     
    setGitCron(config.gitSyncCron ?? '');
  }, [config]);

  const gitDirty =
    (config &&
      (gitName.trim() !== (config.gitAuthorName ?? '').trim() ||
        gitEmail.trim() !== (config.gitAuthorEmail ?? '').trim() ||
        gitCron.trim() !== (config.gitSyncCron ?? '').trim())) ??
    false;

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
  const syncEnabled = config?.gitSyncEnabled ?? true;

  const handleToggleSync = async (enabled: boolean) => {
    setTogglingSync(true);
    try {
      await settingsApi.saveSyncConfig({
        url: config?.remoteUrl ?? '',
        gitSyncEnabled: enabled,
      });
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
  const isConnected =
    !['no_remote', 'no_repo'].includes(syncState) ||
    (syncState === 'no_repo' && isConfigured);
  const canPush = syncState === 'ahead' || syncState === 'remote_empty';
  const canSync =
    syncState === 'behind' ||
    syncState === 'diverged' ||
    (localIsEmpty && syncState === 'synced');

  const handlePush = async () => {
    const msg =
      syncState === 'remote_empty'
        ? '首次推送,将本地数据推送到空远端仓库。'
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

  const handlePublishAll = async () => {
    const ok = await confirm({
      title: '发布全部最新版',
      message:
        '把所有内容(笔记 / 画廊 / 文集条目)的最新提交版本一键上线。常用于从远端恢复后重新上线。',
      confirmLabel: '确认发布',
    });
    if (!ok) return;
    setPublishingAll(true);
    try {
      const result = await settingsApi.publishAll();
      banner.success(
        `已发布 ${result.published} 项${result.skipped ? `,跳过 ${result.skipped} 项` : ''}`,
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
        ? '将归档本地数据后清空,再从远端恢复。归档文件保留在服务器磁盘上。'
        : '将从远端拉取数据并恢复到本地。',
      confirmLabel: '确认恢复',
      danger: hasLocalData,
    });
    if (!ok) return;
    setSyncing(true);
    try {
      const result = await settingsApi.syncFromRemote();
      if (result.success) {
        const note = result.archived ? '(已归档旧数据)' : '';
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

  const effectiveState =
    localIsEmpty && syncState === 'synced' ? 'synced_db_empty' : syncState;
  const syncDisplay = SYNC_STATE_DISPLAY[effectiveState] ?? {
    text: effectiveState,
  };
  const syncValue =
    effectiveState === 'ahead'
      ? `${unpushedCount} 个提交待推送`
      : syncDisplay.text;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          同步
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          配置远端仓库并管理本地与远端的数据同步
        </p>
      </div>
      <Separator />

      {/* ── 远端仓库 ── */}
      <section className="space-y-5">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            远端仓库
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            私有仓库需要访问令牌(PAT)
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div
              className="h-3 w-1/2 rounded-sm animate-pulse"
              style={{ background: 'var(--shelf)' }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="远端地址">
              <Input
                value={formUrl}
                onChange={(e) => {
                  setFormUrl(e.target.value);
                  setValidationResult(null);
                }}
                placeholder="https://github.com/yourname/kb.git"
              />
            </Field>
            <Field
              label="访问令牌(PAT)"
              helper={
                config?.hasToken && !formToken
                  ? '已配置,留空则不修改'
                  : '可选,私有仓库需要'
              }
            >
              <PasswordInput
                value={formToken}
                onChange={(v) => {
                  setFormToken(v);
                  setValidationResult(null);
                }}
              />
            </Field>

            {validationResult && (
              <div
                className="rounded-sm px-2.5 py-1.5 text-xs"
                style={{
                  background: validationResult.valid
                    ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                    : 'color-mix(in srgb, var(--danger) 10%, transparent)',
                  color: validationResult.valid
                    ? 'var(--success)'
                    : 'var(--danger)',
                }}
              >
                {validationResult.valid ? '✓ ' : '✗ '}
                {validationResult.message}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void handleSaveRemote()}
                disabled={savingRemote || !remoteDirty || !formUrl.trim()}
              >
                {savingRemote ? '保存中…' : '保存'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleValidate()}
                disabled={validating || !formUrl.trim()}
              >
                {validating ? '验证中…' : '验证连接'}
              </Button>
            </div>

            {isConfigured && (
              <div className="flex items-center gap-2 pt-1">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: isConnected
                      ? 'var(--success)'
                      : 'var(--danger)',
                  }}
                />
                <span
                  className="text-xs"
                  style={{
                    color: isConnected ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {isConnected ? '已连接' : '连接失败'}
                </span>
                {config?.hasToken && (
                  <span
                    className="text-xs"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    · 令牌已配置
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 数据同步 ── */}
      {isConfigured && (
        <>
          <Separator />
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                数据同步
              </h2>
              {lastRefresh && (
                <span
                  className="text-xs"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  最近检测 {lastRefresh.toLocaleTimeString('zh-CN')}
                </span>
              )}
            </div>

            {/* 总开关 */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div
                  className="text-sm"
                  style={{ color: 'var(--ink)' }}
                >
                  同步到远端
                </div>
                <div
                  className="mt-0.5 text-xs"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  {syncEnabled
                    ? '已开启:内容会按计划推送到远端'
                    : '已关闭:即使配了远端也不会推送'}
                </div>
              </div>
              <Toggle
                checked={syncEnabled}
                onChange={(v) => void handleToggleSync(v)}
                disabled={togglingSync}
              />
            </div>

            <div
              className="space-y-1.5 rounded-sm px-3 py-2.5"
              style={{ background: 'var(--shelf)' }}
            >
              <StatusRow
                label="本地仓库"
                value={syncState === 'no_repo' ? '不存在' : '正常'}
                highlight={syncState === 'no_repo' ? 'danger' : 'success'}
              />
              {storageStatus?.git?.branch && (
                <StatusRow
                  label="同步分支"
                  value={storageStatus.git.branch}
                />
              )}
              <StatusRow
                label="本地内容"
                value={
                  localIsEmpty
                    ? '空'
                    : `${status!.local.contentCount} 个内容项`
                }
              />
              <StatusRow
                label="同步状态"
                value={syncValue}
                highlight={syncDisplay.highlight}
              />
            </div>

            {/* 推送 / 恢复操作 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm"
                    style={{ color: 'var(--ink)' }}
                  >
                    推送到远端
                  </div>
                  <div
                    className="mt-0.5 text-xs"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    {!syncEnabled
                      ? '同步已关闭'
                      : syncState === 'ahead'
                        ? `${unpushedCount} 个提交待推送`
                        : syncState === 'remote_empty'
                          ? '首次推送到空仓库'
                          : syncState === 'diverged'
                            ? '历史不一致,无法推送'
                            : '已是最新'}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handlePush()}
                  disabled={busy || !canPush || !syncEnabled}
                >
                  {pushing ? '推送中…' : '推送'}
                </Button>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm"
                    style={{ color: 'var(--ink)' }}
                  >
                    从远端恢复
                  </div>
                  <div
                    className="mt-0.5 text-xs"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    {syncState === 'diverged'
                      ? '本地与远端历史不一致,恢复将覆盖本地数据'
                      : localIsEmpty
                        ? '从远端拉取数据恢复到本地'
                        : '归档本地数据后,从远端重新恢复'}
                  </div>
                </div>
                <Button
                  variant={canSync && !localIsEmpty ? 'danger' : 'outline'}
                  size="sm"
                  onClick={() => void handleSync()}
                  disabled={busy || !canSync}
                >
                  {syncing ? '恢复中…' : '恢复'}
                </Button>
              </div>
            </div>
          </section>
        </>
      )}

      <Separator />

      {/* ── 内容发布 ── */}
      <section className="space-y-4">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            内容发布
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            发布状态不进 Git,从远端恢复后所有内容默认未发布
          </p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm" style={{ color: 'var(--ink)' }}>
              发布全部最新版
            </div>
            <div
              className="mt-0.5 text-xs"
              style={{ color: 'var(--ink-ghost)' }}
            >
              把所有内容(笔记 / 画廊 / 文集条目)的最新提交版本一键上线
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handlePublishAll()}
            disabled={busy}
          >
            {publishingAll ? '发布中…' : '发布全部'}
          </Button>
        </div>
      </section>

      {/* ── Git 提交配置 ── */}
      {isConfigured && (
        <>
          <Separator />
          <section className="space-y-5">
            <div>
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                Git 提交配置
              </h2>
              <p
                className="mt-0.5 text-xs"
                style={{ color: 'var(--ink-ghost)' }}
              >
                内容提交时使用的署名信息和自动同步频率
              </p>
            </div>
            <div className="space-y-4">
              <Field label="提交者名称">
                <Input
                  value={gitName}
                  onChange={(e) => setGitName(e.target.value)}
                  placeholder="Lux Stirring"
                  className="max-w-md"
                />
              </Field>
              <Field label="提交者邮箱">
                <Input
                  value={gitEmail}
                  onChange={(e) => setGitEmail(e.target.value)}
                  placeholder="no-reply@lux-stirring.local"
                  className="max-w-md"
                />
              </Field>
              <Field
                label="兜底定时任务"
                helper="主推送靠 commit 后 15 秒去抖即时推;这条频率只用于兜底扫漏(进程崩/网络断时补推)+ 跨月归档。默认凌晨 3 点没人用时跑,最省心。"
              >
                <NativeSelect value={gitCron} onChange={setGitCron}>
                  {CRON_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                onClick={() => void handleSaveGit()}
                disabled={savingGit || !gitDirty}
              >
                {savingGit ? '保存中…' : '保存'}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
