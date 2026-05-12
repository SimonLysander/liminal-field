import { request } from './request';

// ── 类型 ────────────────────────────────────────────────

/** 全量配置（脱敏，只含用户通过 UI 管理的字段） */
export interface SettingsConfigView {
  sync: {
    remoteUrl: string | null;
    hasToken: boolean;
    gitAuthorName: string;
    gitAuthorEmail: string;
    gitSyncCron: string;
  };
  integration: {
    hasMineruToken: boolean;
  };
}

/** 综合状态 */
export interface SettingsStatus {
  local: {
    contentCount: number;
    snapshotCount: number;
    navigationCount: number;
  };
  remote: {
    configured: boolean;
    connected: boolean;
    isEmpty: boolean | null;
  };
}

/** 存储状态（诊断） */
export interface StorageStatus {
  oss: { connected: boolean; bucket: string; region: string };
  git: {
    branch: string;
    totalCommits: number;
    unpushedCommits: number;
    lastCommitMessage: string;
    lastCommitTime: string;
    remote: string;
  } | null;
}

// ── API ─────────────────────────────────────────────────

export const settingsApi = {
  // 全量配置读取
  getConfig: () => request<SettingsConfigView>('/settings/config'),

  // 综合状态
  getStatus: () => request<SettingsStatus>('/settings/status'),

  // 存储状态（诊断）
  getStorageStatus: () => request<StorageStatus>('/settings/storage-status'),

  // 分区保存
  saveSyncConfig: (data: {
    url: string;
    token?: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    gitSyncCron?: string;
  }) =>
    request<{ success: boolean }>('/settings/sync-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  saveIntegrationConfig: (data: { mineruToken?: string }) =>
    request<{ success: boolean }>('/settings/integration-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // 远端验证
  validateRemote: (url: string, token?: string) =>
    request<{ valid: boolean; message: string }>(
      '/settings/remote-config/validate',
      {
        method: 'POST',
        body: JSON.stringify({ url, token }),
      },
    ),

  // 同步操作
  pushToRemote: () =>
    request<{ success: boolean; message: string }>(
      '/settings/push-to-remote',
      { method: 'POST' },
    ),

  syncFromRemote: () =>
    request<{
      success: boolean;
      message: string;
      archived: boolean;
      recovered: number;
    }>('/settings/sync-from-remote', { method: 'POST' }),

  // 兼容 SyncDialog
  getSyncStatus: () =>
    request<{
      branch: string;
      totalCommits: number;
      unpushedCommits: number;
      lastCommitMessage: string;
      lastCommitTime: string;
      remote: string;
    } | null>('/settings/sync-status'),
};
