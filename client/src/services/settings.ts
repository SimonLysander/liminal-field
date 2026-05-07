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
};
