import { request } from './request';

// ── 类型 ────────────────────────────────────────────────

/** 所有者身份信息 */
export interface OwnerProfile {
  name: string;
  birthday: string;
  bio: string;
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
  /**
   * 该 agent 使用的 AI provider id(2026-05-30,#5 重构)。fallback 兜底:
   * 4 个 tier 独立字段(下方)为空时回退到 providerId,providerId 为空再回退
   * 到全局 activeAiProviderId。
   */
  providerId: string;

  /** 4 个 tier 独立 provider 绑定(2026-05-31,#143):每 tier 调用时优先用对应字段 */
  flashProviderId: string;
  standardProviderId: string;
  thinkProviderId: string;
  visionProviderId: string;

  /**
   * 该 agent 启用的 Skill ID 列表(spec 2026-06-03)。
   * 后端配置时硬校验 skill.requiredTools ⊆ tools,违反 → 400。
   * 删 Skill / 移除 tool 时由后端 SystemConfigService 自动清理。
   */
  enabledSkillIds: string[];
  builtin?: boolean;
}

/**
 * 工具参数(catalog 子结构)。
 * 字段含义见后端 server/src/modules/agent/tools/tool-catalog.ts。
 */
export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * 工具元数据(GET /agent-configs/tool-catalog 返回项)。
 * 真相在后端 server/src/modules/agent/tools/tool-catalog.ts。
 *
 * 字段:
 *   - displayName  chip 短名(空间小,不超 6 字)
 *   - summary      chip 副标 / 一行说明(不超 25 字)
 *   - detail       工具页展开后的段落
 *   - params       输入参数列表
 *   - returns      返回结果格式
 */
export interface ToolCatalogEntry {
  name: string;
  displayName: string;
  summary: string;
  detail: string;
  params: ToolParam[];
  returns: string;
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
    hasTavilyApiKey: boolean;
    hasFirecrawlApiKey: boolean;
    hasJinaApiKey: boolean;
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
      /** 视觉模型,可选;空串表示该 provider 不支持视觉 */
      visionModel: string;
      /** 上下文窗口(token):compaction 分母,手动必填 */
      contextWindow: number;
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
  /**
   * mongo 当前 order 派生的清单 yaml 跟磁盘 yaml 不一致——
   * 平时 reorder 不触发 commit,这个信号告诉 UI 状态行 + 推送按钮:
   * "有 reorder 待推",syncState='synced' 时仍可推送。
   */
  manifestDirty?: boolean;
}

/**
 * 推送前给 UI 展示的 manifest 差异(reorder/rename/add/remove 节点路径)。
 * 后端从 mongo 派生 manifest 跟磁盘 yaml 做语义 diff 得到。
 */
export interface ManifestDiff {
  reorderedPaths: string[];
  renamedPaths: { from: string; to: string }[];
  addedPaths: string[];
  removedPaths: string[];
  totalChanges: number;
}

// ── API ─────────────────────────────────────────────────

export const settingsApi = {
  // 全量配置读取
  getConfig: () => request<SettingsConfigView>('/settings/config'),

  // 综合状态
  getStatus: () => request<SettingsStatus>('/settings/status'),

  // 存储状态（诊断）
  getStorageStatus: () => request<StorageStatus>('/settings/storage-status'),

  // 推送 dialog:本次会推什么(路径列表)
  getManifestDiff: () => request<ManifestDiff>('/settings/manifest-diff'),

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

  saveIntegrationConfig: (data: {
    mineruToken?: string;
    tavilyApiKey?: string;
    firecrawlApiKey?: string;
    jinaApiKey?: string;
  }) =>
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
    visionModel?: string;
    contextWindow: number;
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
      visionModel?: string;
      apiKey?: string;
      contextWindow?: number;
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

  saveOwnerProfile: (data: { name?: string; birthday?: string; bio?: string }) =>
    request<{ success: boolean }>('/settings/owner-profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // ── Agent 入口配置管理 ─────────────────────────────────

  /** 获取所有 agent 入口配置 */
  getAgentConfigs: () =>
    request<AgentConfig[]>('/settings/agent-configs'),

  /** 获取可用工具池(slug 白名单,决定 UI 上能勾选哪些) */
  getAvailableTools: () =>
    request<string[]>('/settings/agent-configs/available-tools'),

  /**
   * 获取工具元数据全集(slug → 中文名 + 描述)。
   * UI 用它做 ChipSelector 的 renderLabel/renderMeta 翻译,
   * 找不到的 slug fallback 回原 slug(老数据/未登记的工具不破)。
   */
  getToolCatalog: () =>
    request<ToolCatalogEntry[]>('/settings/agent-configs/tool-catalog'),

  /**
   * 保存 agent 入口配置（upsert by key）。
   *
   * cleaned 列表(spec §6.3):用户改 tools 但没显式动 enabledSkillIds 时,
   * 后端会自动剔除因工具缺失而失效的 skill,把列表传回让前端 toast 告知。
   * 显式管 enabledSkillIds 走严格 validate 路径,cleaned 总是 []。
   */
  saveAgentConfig: (key: string, data: Partial<Omit<AgentConfig, 'key'>>) =>
    request<{
      success: boolean;
      cleaned: Array<{ agent: string; skillName: string }>;
    }>(`/settings/agent-configs/${key}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** 删除 agent 入口配置 */
  deleteAgentConfig: (key: string) =>
    request<{ success: boolean }>(`/settings/agent-configs/${key}`, {
      method: 'DELETE',
    }),
};
