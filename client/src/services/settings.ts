import { request } from './request';

// 知识库状态概览（Git 仓库 + 数据库数量）
export interface SettingsStatus {
  dbItemCount: number;
  dbSnapshotCount: number;
  gitItemCount: number;
  hasManifest: boolean;
}

// 数据恢复扫描结果
export interface ScanResult {
  gitItems: string[];
  dbItems: string[];
  missingInDb: string[];
  orphanedInDb: string[];
  hasManifest: boolean;
}

// 数据恢复执行结果
export interface RecoveryResult {
  recovered: number;
  errors: string[];
}

export const settingsApi = {
  getStatus: () => request<SettingsStatus>('/settings/status'),

  validateRemote: (url: string, token?: string) =>
    request<{ valid: boolean; message: string }>('/settings/kb-remote/validate', {
      method: 'POST',
      body: JSON.stringify({ url, token }),
    }),

  saveRemote: (url: string, token?: string) =>
    request<{ success: boolean }>('/settings/kb-remote', {
      method: 'PUT',
      body: JSON.stringify({ url, token }),
    }),

  scan: () => request<ScanResult>('/settings/recovery/scan', { method: 'POST' }),

  execute: (contentIds?: string[]) =>
    request<RecoveryResult>('/settings/recovery/execute', {
      method: 'POST',
      body: JSON.stringify({ contentIds }),
    }),

  // 获取 Git 远程同步状态（分支、提交数、待推送数等）
  getSyncStatus: () =>
    request<{
      branch: string;
      totalCommits: number;
      unpushedCommits: number;
      lastCommitMessage: string;
      lastCommitTime: string;
      remote: string;
    } | null>('/settings/sync-status'),

  // 将本地提交推送到远程仓库
  pushToRemote: () =>
    request<{ success: boolean; message: string }>('/settings/push-to-remote', {
      method: 'POST',
    }),

  // 从远程仓库同步恢复数据
  syncFromRemote: () =>
    request<{
      success: boolean;
      recovered: number;
      errors: string[];
      message: string;
    }>('/settings/sync-from-remote', { method: 'POST' }),
};
