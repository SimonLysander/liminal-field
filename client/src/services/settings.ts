import { request } from './request';

// ── 类型 ────────────────────────────────────────────────

/** 所有者身份信息 */
export interface OwnerProfile {
  name: string;
  birthday: string;
  bio: string;
  interests: string;
}

/** Agent 入口配置 */
export interface AgentConfig {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  systemPrompt: string;
  tools: string[];
  /** 默认模型层级：flash / standard / think */
  tier: string;
}

/** 全量配置（脱敏，只含用户通过 UI 管理的字段） */
export interface SettingsConfigView {
  sync: {
    remoteUrl: string | null;
    hasToken: boolean;
    gitAuthorName: string;
    gitAuthorEmail: string;
    gitSyncCron: string;
    /** 同步开关:关闭时即使配了远端也不 push */
    gitSyncEnabled: boolean;
  };
  integration: {
    hasMineruToken: boolean;
  };
  ai: {
    /** 已配置的 AI 提供商列表（API Key 脱敏，不含原文） */
    providers: {
      id: string;
      provider: string;
      name: string;
      flashModel: string;
      standardModel: string;
      thinkModel: string;
      hasApiKey: boolean;
    }[];
    /** 当前启用的提供商 id */
    activeProviderId: string;
    aiSystemPrompt: string;
  };
  /** Agent 入口配置列表 */
  agent: {
    configs: AgentConfig[];
  };
  /** 所有者身份信息 */
  owner: OwnerProfile;
}

/** 本地数据计数 */
export interface SettingsStatus {
  local: {
    contentCount: number;
    snapshotCount: number;
    navigationCount: number;
  };
}

/** 存储状态（诊断） */
export interface StorageStatus {
  oss: { connected: boolean; bucket: string; region: string };
  git: {
    branch: string;
    totalCommits: number;
    unpushedCommits: number;
    syncState:
      | 'no_repo'
      | 'no_remote'
      | 'remote_empty'
      | 'synced'
      | 'ahead'
      | 'diverged'
      | 'behind';
    lastCommitMessage: string;
    lastCommitTime: string;
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
    gitSyncEnabled?: boolean;
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

  // AI 多提供商管理
  addAiProvider: (data: {
    provider: string;
    apiKey: string;
    flashModel: string;
    standardModel: string;
    thinkModel: string;
  }) =>
    request<{ success: boolean; id: string }>('/settings/ai-providers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteAiProvider: (id: string) =>
    request<{ success: boolean }>(`/settings/ai-providers/${id}`, {
      method: 'DELETE',
    }),

  activateAiProvider: (id: string) =>
    request<{ success: boolean }>(`/settings/ai-providers/${id}/activate`, {
      method: 'PUT',
    }),

  /** 编辑提供商的 tier 绑定或 API Key（只传需要更新的字段） */
  updateAiProvider: (
    id: string,
    data: {
      flashModel?: string;
      standardModel?: string;
      thinkModel?: string;
      apiKey?: string;
    },
  ) =>
    request<{ success: boolean }>(`/settings/ai-providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listProviderModels: (data: { provider: string; apiKey: string }) =>
    request<{ models: string[] }>('/settings/ai-providers/list-models', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 验证连接时用 standardModel 发极小请求 */
  validateAiProvider: (data: {
    provider: string;
    apiKey: string;
    standardModel: string;
  }) =>
    request<{ valid: boolean; message: string }>('/settings/ai-providers/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  saveAiSystemPrompt: (prompt: string) =>
    request<{ success: boolean }>('/settings/ai-system-prompt', {
      method: 'PUT',
      body: JSON.stringify({ prompt }),
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

  // 清空本地
  clearLocal: (archive?: boolean) =>
    request<{ success: boolean; message: string; archived: boolean }>(
      '/settings/clear-local',
      {
        method: 'POST',
        body: JSON.stringify({ archive: archive ?? false }),
      },
    ),

  // 一键发布全部内容最新版(灾后/恢复后重新上线)
  publishAll: () =>
    request<{ success: boolean; published: number; skipped: number }>(
      '/settings/publish-all',
      { method: 'POST' },
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
      syncState: string;
      lastCommitMessage: string;
      lastCommitTime: string;
    } | null>('/settings/sync-status'),

  // ── 所有者身份管理 ──────────────────────────────────────

  getOwnerProfile: () =>
    request<OwnerProfile>('/settings/owner-profile'),

  saveOwnerProfile: (data: { name?: string; bio?: string }) =>
    request<{ success: boolean }>('/settings/owner-profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Agent 入口配置管理 ─────────────────────────────────

  /** 获取所有 agent 入口配置 */
  getAgentConfigs: () =>
    request<AgentConfig[]>('/settings/agent-configs'),

  /** 保存 agent 入口配置（upsert by key） */
  saveAgentConfig: (key: string, data: Partial<Omit<AgentConfig, 'key'>>) =>
    request<{ success: boolean }>(`/settings/agent-configs/${key}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** 删除 agent 入口配置 */
  deleteAgentConfig: (key: string) =>
    request<{ success: boolean }>(`/settings/agent-configs/${key}`, {
      method: 'DELETE',
    }),
};
