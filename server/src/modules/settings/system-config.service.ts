import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import simpleGit from 'simple-git';
import {
  applyKbGitTokenToGithubHttps,
  redactKbRemoteUrlForLog,
} from '../../common/kb-remote-url';
import { ContentRepoService } from '../content/content-repo.service';
import { SystemConfigRepository } from './system-config.repository';
import type { AgentEntryConfig } from './system-config.entity';

/** 前端展示用的脱敏配置（只含用户通过 UI 管理的字段） */
export interface SettingsConfigView {
  sync: {
    remoteUrl: string | null;
    hasToken: boolean;
    gitAuthorName: string;
    gitAuthorEmail: string;
    gitSyncCron: string;
    /** 同步开关：关闭时即使配了远端也不 push */
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
    configs: Array<{
      key: string;
      name: string;
      description: string;
      enabled: boolean;
      systemPrompt: string;
      tools: string[];
      tier: string;
    }>;
  };
  /** 所有者身份信息 */
  owner: {
    name: string;
    birthday: string;
    bio: string;
    interests: string;
  };
}

/**
 * SystemConfigService — 系统配置管理。
 *
 * 职责：
 * 1. 启动时从 MongoDB 加载用户显式保存的配置，覆盖 env
 * 2. 分区保存：sync / integration（OSS 走 env，不入 MongoDB）
 * 3. 保存后同步到 process.env + 相关运行时组件
 */
@Injectable()
export class SystemConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigService.name);

  /**
   * writing-advisor 入口的完整工具集——预置新配置与给旧配置补齐缺失工具共用这一份,
   * 避免两处手抄数组日久不同步(新增工具只需改这里)。
   */
  private static readonly WRITING_ADVISOR_TOOLS = [
    'search_knowledge_base',
    'list_knowledge_base',
    'read_document_content',
    'get_current_draft',
    'propose_edit', // Aurora 改稿 v1：查找-替换块落成 suggestion 痕迹，Task 9 才删
    // v2 锚点驱动改稿工具(替代 propose_edit,见 2026-05-26 spec)
    'rewrite_selection',
    'insert_at_cursor',
    'rewrite_document',
    'remember',
    'forget',
    'sub_agent',
    'write_tasks',
    'read_conversation_history',
  ];

  constructor(
    private readonly repo: SystemConfigRepository,
    private readonly contentRepoService: ContentRepoService,
  ) {}

  /**
   * 启动加载：MongoDB 有用户显式保存的配置，则覆盖 env。
   * 不从 env 自动迁移——未通过 UI 配置过的字段不写入 MongoDB。
   * 同时检查预置 agent 配置，首次启动时自动写入 writing-advisor。
   */
  async onModuleInit(): Promise<void> {
    const config = await this.repo.get();

    if (config) {
      this.applyAllToEnv(config);
      this.logger.log('Loaded system config from MongoDB');
    }

    // 预置写作顾问 agent 配置 + 补齐新增工具
    if (!config?.agentConfigs?.length) {
      await this.repo.patch({
        agentConfigs: [
          {
            key: 'writing-advisor',
            name: '写作顾问',
            description: '帮助改善文章结构、逻辑脉络和表达方式',
            enabled: true,
            systemPrompt: '',
            tools: [...SystemConfigService.WRITING_ADVISOR_TOOLS],
            tier: 'standard',
          },
        ] as AgentEntryConfig[],
      });
      this.logger.log('预置 writing-advisor agent 配置已写入');
    } else {
      // 补齐新增工具：已有配置可能缺少后来新加的工具
      const allTools = SystemConfigService.WRITING_ADVISOR_TOOLS;
      const wa = config?.agentConfigs?.find((c) => c.key === 'writing-advisor');
      if (wa) {
        const missing = allTools.filter((t) => !wa.tools.includes(t));
        if (missing.length > 0) {
          wa.tools.push(...missing);
          await this.repo.patch({ agentConfigs: config.agentConfigs });
          this.logger.log(`writing-advisor 补齐工具: ${missing.join(', ')}`);
        }
      }
    }
  }

  /** 读取全部配置（脱敏，不暴露密钥原文） */
  async getConfigView(): Promise<SettingsConfigView> {
    const config = await this.repo.get();
    return {
      sync: {
        remoteUrl: config?.remoteUrl || null,
        hasToken: !!config?.gitToken,
        gitAuthorName: config?.gitAuthorName || '',
        gitAuthorEmail: config?.gitAuthorEmail || '',
        gitSyncCron: config?.gitSyncCron || '',
        gitSyncEnabled: config?.gitSyncEnabled ?? true,
      },
      integration: {
        hasMineruToken: !!config?.mineruToken,
      },
      ai: {
        providers: (config?.aiProviders ?? []).map((p) => ({
          id: p.id,
          provider: p.provider,
          name: p.name,
          flashModel: p.flashModel,
          standardModel: p.standardModel,
          thinkModel: p.thinkModel,
          hasApiKey: !!p.apiKey,
        })),
        activeProviderId: config?.activeAiProviderId || '',
        aiSystemPrompt: config?.aiSystemPrompt || '',
      },
      // Agent 入口配置：直接返回完整数据（无敏感字段，无需脱敏）
      agent: {
        configs: (config?.agentConfigs ?? []).map((c) => ({
          key: c.key,
          name: c.name,
          description: c.description,
          enabled: c.enabled,
          systemPrompt: c.systemPrompt,
          tools: c.tools,
          tier: c.tier,
        })),
      },
      // 所有者身份信息
      owner: {
        name: config?.ownerProfile?.name || '',
        birthday: config?.ownerProfile?.birthday || '',
        bio: config?.ownerProfile?.bio || '',
        interests: config?.ownerProfile?.interests || '',
      },
    };
  }

  // ── 分区保存 ──────────────────────────────────────────────

  async saveSyncConfig(input: {
    remoteUrl: string;
    token?: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    gitSyncCron?: string;
    gitSyncEnabled?: boolean;
  }): Promise<void> {
    const existing = await this.repo.get();
    const fields: Record<string, string> = {
      remoteUrl: input.remoteUrl,
      gitToken:
        input.token !== undefined ? input.token : existing?.gitToken || '',
    };
    if (input.gitAuthorName !== undefined)
      fields.gitAuthorName = input.gitAuthorName;
    if (input.gitAuthorEmail !== undefined)
      fields.gitAuthorEmail = input.gitAuthorEmail;
    if (input.gitSyncCron !== undefined) fields.gitSyncCron = input.gitSyncCron;

    await this.repo.patch(fields);
    // gitSyncEnabled 是布尔,单独 patch(不混进字符串 fields)
    if (input.gitSyncEnabled !== undefined) {
      await this.repo.patch({ gitSyncEnabled: input.gitSyncEnabled });
      process.env.GIT_SYNC_ENABLED = input.gitSyncEnabled ? 'true' : 'false';
    }

    // 同步到 env
    process.env.KB_REMOTE_URL = input.remoteUrl;
    process.env.KB_GIT_TOKEN = fields.gitToken;
    if (fields.gitAuthorName !== undefined)
      process.env.CONTENT_GIT_AUTHOR_NAME = fields.gitAuthorName;
    if (fields.gitAuthorEmail !== undefined)
      process.env.CONTENT_GIT_AUTHOR_EMAIL = fields.gitAuthorEmail;
    if (fields.gitSyncCron !== undefined)
      process.env.GIT_SYNC_CRON = fields.gitSyncCron;

    // 更新 Git remote
    await this.syncGitRemote(input.remoteUrl, fields.gitToken);

    this.logger.log(
      `Sync config saved: ${redactKbRemoteUrlForLog(input.remoteUrl)}`,
    );
  }

  async saveIntegrationConfig(input: { mineruToken?: string }): Promise<void> {
    const fields: Record<string, string> = {};
    if (input.mineruToken !== undefined) {
      fields.mineruToken = input.mineruToken;
      process.env.MINERU_TOKEN = input.mineruToken;
    }

    await this.repo.patch(fields);
    this.logger.log('Integration config saved');
  }

  /** 添加一个 AI 提供商配置（三 tier 模型绑定） */
  async addAiProvider(input: {
    id: string;
    provider: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    flashModel: string;
    standardModel: string;
    thinkModel: string;
    /** 模型上下文窗口(token)，来自提供商预设，用于 compaction 占比计算的分母 */
    contextWindow: number;
  }): Promise<void> {
    const config = await this.repo.get();
    const providers = config?.aiProviders ?? [];
    providers.push({
      id: input.id,
      provider: input.provider,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      flashModel: input.flashModel,
      standardModel: input.standardModel,
      thinkModel: input.thinkModel,
      contextWindow: input.contextWindow,
    });
    await this.repo.patch({ aiProviders: providers });

    // 如果是第一个提供商，自动设为启用
    if (providers.length === 1) {
      await this.repo.patch({ activeAiProviderId: input.id });
    }
    this.logger.log(`AI provider added: ${input.name} (${input.provider})`);
  }

  /** 删除一个 AI 提供商配置 */
  async deleteAiProvider(providerId: string): Promise<void> {
    const config = await this.repo.get();
    const providers = (config?.aiProviders ?? []).filter(
      (p) => p.id !== providerId,
    );
    const patches: Record<string, any> = { aiProviders: providers };
    // 如果删的是当前启用的，清空 activeId 或切换到第一个
    if (config?.activeAiProviderId === providerId) {
      patches.activeAiProviderId = providers.length > 0 ? providers[0].id : '';
    }
    await this.repo.patch(patches);
    this.logger.log(`AI provider deleted: ${providerId}`);
  }

  /** 切换启用的 AI 提供商 */
  async setActiveAiProvider(providerId: string): Promise<void> {
    await this.repo.patch({ activeAiProviderId: providerId });
    this.logger.log(`Active AI provider set to: ${providerId}`);
  }

  /**
   * 更新 AI 提供商的 tier 绑定或 API Key。
   * 只更新传入的字段，未传字段保持不变。
   */
  async updateAiProvider(
    id: string,
    fields: {
      flashModel?: string;
      standardModel?: string;
      thinkModel?: string;
      apiKey?: string;
    },
  ): Promise<void> {
    const config = await this.repo.get();
    const providers = (config?.aiProviders ?? []).map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...(fields.flashModel !== undefined
          ? { flashModel: fields.flashModel }
          : {}),
        ...(fields.standardModel !== undefined
          ? { standardModel: fields.standardModel }
          : {}),
        ...(fields.thinkModel !== undefined
          ? { thinkModel: fields.thinkModel }
          : {}),
        ...(fields.apiKey !== undefined ? { apiKey: fields.apiKey } : {}),
      };
    });
    await this.repo.patch({ aiProviders: providers });
    this.logger.log(`AI provider updated: ${id}`);
  }

  /** 保存全局 AI system prompt */
  async saveAiSystemPrompt(prompt: string): Promise<void> {
    await this.repo.patch({ aiSystemPrompt: prompt });
  }

  /**
   * 读取当前启用的 AI 提供商配置（内部用，含明文密钥）。
   * tier 参数决定使用哪个模型名：flash / standard / think。
   * AgentService 调用此方法获取 LLM 连接信息。
   */
  async getAiConfig(
    // tier 接受 string：来源含前端传入的运行时值，未知值在下方逻辑兜底为 standard
    tier: string = 'standard',
  ): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    aiSystemPrompt: string;
    /** 模型上下文窗口(token):compaction 占比触发与上下文组装的分母。无配置时回退 32000。 */
    contextWindow: number;
  }> {
    const config = await this.repo.get();
    const activeId = config?.activeAiProviderId || '';
    const active = (config?.aiProviders ?? []).find((p) => p.id === activeId);

    // 根据 tier 选择对应的模型名
    let model = '';
    if (active) {
      if (tier === 'flash') model = active.flashModel;
      else if (tier === 'think') model = active.thinkModel;
      else model = active.standardModel; // 默认 standard
    }

    return {
      baseUrl: active?.baseUrl || '',
      apiKey: active?.apiKey || '',
      model,
      aiSystemPrompt: config?.aiSystemPrompt || '',
      // 历史 provider 可能未存 contextWindow,回退一个保守默认,避免 compaction 分母为 0
      contextWindow: active?.contextWindow || 32000,
    };
  }

  // ── 所有者身份管理 ────────────────────────────────────────

  /** 读取所有者身份信息 */
  async getOwnerProfile(): Promise<{
    name: string;
    birthday: string;
    bio: string;
    interests: string;
  }> {
    const config = await this.repo.get();
    return {
      name: config?.ownerProfile?.name || '',
      birthday: config?.ownerProfile?.birthday || '',
      bio: config?.ownerProfile?.bio || '',
      interests: config?.ownerProfile?.interests || '',
    };
  }

  /** 保存所有者身份信息（partial update） */
  async saveOwnerProfile(input: {
    name?: string;
    birthday?: string;
    bio?: string;
    interests?: string;
  }): Promise<void> {
    const config = await this.repo.get();
    const existing = config?.ownerProfile || {
      name: '',
      birthday: '',
      bio: '',
      interests: '',
    };
    await this.repo.patch({
      ownerProfile: {
        name: input.name ?? existing.name,
        birthday: input.birthday ?? existing.birthday,
        bio: input.bio ?? existing.bio,
        interests: input.interests ?? existing.interests,
      },
    });
    this.logger.log('Owner profile saved');
  }

  // ── Agent 入口配置管理 ────────────────────────────────────

  /** 读取全部 agent 入口配置 */
  async getAgentConfigs(): Promise<AgentEntryConfig[]> {
    const config = await this.repo.get();
    return config?.agentConfigs ?? [];
  }

  /**
   * 保存 agent 入口配置（upsert by key）。
   * key 已存在则合并更新，不存在则追加到数组末尾。
   */
  async saveAgentConfig(
    key: string,
    input: Partial<Omit<AgentEntryConfig, 'key'>>,
  ): Promise<void> {
    const config = await this.repo.get();
    const existing = config?.agentConfigs ?? [];
    const idx = existing.findIndex((c) => c.key === key);

    if (idx >= 0) {
      // 更新已有条目：只覆盖传入字段
      existing[idx] = { ...existing[idx], ...input, key };
    } else {
      // 新增条目，补齐默认值
      existing.push({
        key,
        name: input.name ?? key,
        description: input.description ?? '',
        enabled: input.enabled ?? true,
        systemPrompt: input.systemPrompt ?? '',
        tools: input.tools ?? [],
        tier: input.tier ?? 'standard',
      });
    }

    await this.repo.patch({ agentConfigs: existing });
    this.logger.log(`Agent config saved: ${key}`);
  }

  /** 按 key 查找 agent 入口配置（供 AgentService 调用） */
  async getAgentConfig(key: string): Promise<AgentEntryConfig | null> {
    const config = await this.repo.get();
    return config?.agentConfigs?.find((c) => c.key === key) ?? null;
  }

  /** 删除 agent 入口配置（by key） */
  async deleteAgentConfig(key: string): Promise<void> {
    const config = await this.repo.get();
    const filtered = (config?.agentConfigs ?? []).filter((c) => c.key !== key);
    await this.repo.patch({ agentConfigs: filtered });
    this.logger.log(`Agent config deleted: ${key}`);
  }

  // ── 兼容旧接口 ───────────────────────────────────────────

  async getConfig(): Promise<{ remoteUrl: string | null; hasToken: boolean }> {
    const config = await this.repo.get();
    return {
      remoteUrl: config?.remoteUrl || null,
      hasToken: !!config?.gitToken,
    };
  }

  async saveConfig(remoteUrl: string, token?: string): Promise<void> {
    await this.saveSyncConfig({ remoteUrl, token });
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /** 将 MongoDB 配置同步到 process.env（只覆盖非空值） */
  private applyAllToEnv(config: {
    remoteUrl?: string;
    gitToken?: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    gitSyncCron?: string;
    gitSyncEnabled?: boolean;
    mineruToken?: string;
  }): void {
    if (config.remoteUrl) process.env.KB_REMOTE_URL = config.remoteUrl;
    if (config.gitToken) process.env.KB_GIT_TOKEN = config.gitToken;
    if (config.gitAuthorName)
      process.env.CONTENT_GIT_AUTHOR_NAME = config.gitAuthorName;
    if (config.gitAuthorEmail)
      process.env.CONTENT_GIT_AUTHOR_EMAIL = config.gitAuthorEmail;
    if (config.gitSyncCron) process.env.GIT_SYNC_CRON = config.gitSyncCron;
    // 同步开关:只在明确关闭时为 'false',push 路径据此跳过(默认视为开启)
    process.env.GIT_SYNC_ENABLED =
      config.gitSyncEnabled === false ? 'false' : 'true';
    if (config.mineruToken) process.env.MINERU_TOKEN = config.mineruToken;
  }

  /**
   * 更新 KB Git 仓库的 origin remote URL。
   *
   * 防御措施：
   * 1. resolvedUrl 为空时跳过（防止写入 "undefined" 字面量）
   * 2. 验证 git rev-parse --show-toplevel 指向 repoRoot（防止误操作项目代码仓库）
   */
  private async syncGitRemote(remoteUrl: string, token: string): Promise<void> {
    const resolvedUrl = applyKbGitTokenToGithubHttps(
      remoteUrl,
      token || undefined,
    );
    if (!resolvedUrl || resolvedUrl === 'undefined') {
      this.logger.warn('syncGitRemote: resolvedUrl 为空，跳过');
      return;
    }
    try {
      const expectedRoot = this.contentRepoService.repoRoot;
      const git = simpleGit(expectedRoot);

      // 安全检查：确认 git 仓库根目录是 KB 仓库，不是项目代码仓库
      const actualRoot = (
        await git.raw(['rev-parse', '--show-toplevel'])
      ).trim();
      if (actualRoot !== expectedRoot) {
        this.logger.error(
          `syncGitRemote: git 根目录不匹配（期望 ${expectedRoot}，实际 ${actualRoot}），跳过以防污染项目仓库`,
        );
        return;
      }

      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (!origin) {
        await git.addRemote('origin', resolvedUrl);
      } else {
        await git.remote(['set-url', 'origin', resolvedUrl]);
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `更新 Git remote 失败: ${redactKbRemoteUrlForLog(rawMsg)}`,
      );
    }
  }
}
