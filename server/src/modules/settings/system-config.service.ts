import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import simpleGit from 'simple-git';
import {
  applyKbGitTokenToGithubHttps,
  redactKbRemoteUrlForLog,
} from '../../common/kb-remote-url';
import { ContentRepoService } from '../content/content-repo.service';
import {
  SkillService,
  SKILL_DELETED_EVENT,
  type SkillDeletedEvent,
} from '../skill/skill.service';
import { SystemConfigRepository } from './system-config.repository';
import type { AgentEntryConfig } from './system-config.entity';
// 从 settings/digest-report-analyst.md 加载报告分析师默认 system prompt(原散落字符串 → promptManager 统一托管)
import { PromptManagerService } from '../../infrastructure/prompt/prompt-manager.service';

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
    hasTavilyApiKey: boolean;
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
      /** 上下文窗口(token):compaction 分母,手动必填配置 */
      contextWindow: number;
      hasApiKey: boolean;
    }[];
    /** 当前启用的提供商 id */
    activeProviderId: string;
    aiSystemPrompt: string;
  };
  /**
   * Agent 入口配置列表。
   * 类型同源 AgentEntryConfig(2026-06-03 review F4-c):以前手抄子集,
   * 漏了 4 个 providerId + enabledSkillIds,前端拿不到只能再请求 getAgentConfigs。
   * 全字段直接透出(无敏感),前端按需消费。
   */
  agent: {
    configs: AgentEntryConfig[];
  };
  /** 所有者身份信息 */
  owner: {
    name: string;
    birthday: string;
    bio: string;
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
    // 文集条目场景:读同集其它条目当前内容(装配层按是否文集条目实际挂载)
    'read_collection_entry',
    // 2026-05-30 event log 架构:
    // - remember 重做成"主 agent 批量觉察"(append-only,不再 upsert by title)
    // - forget 已彻底拔掉(岁月史书无 forget,只有时间推移与重派生画像)
    'remember',
    'recall_memory',
    'search_memories',
    'sub_agent',
    'write_tasks',
    'read_conversation_history',
    // 2026-06-04 改稿(propose_document_rewrite)能力整体停用(用户要求):
    // 从默认工具集移除 → 不再随启动 refill 补回、不再出现在工具池(getAvailableTools)。
    // 恢复:加回 'propose_document_rewrite' + tool.assembler 取消注释 + prompt.handler 改稿指引 + 前端开关。
    // 'propose_document_rewrite',
    // 联网能力:web_search(Tavily/Serper/...)+ web_fetch(Jina Reader/...)
    // 装配层会按 .env 是否配 key 实际挂载(没 key 时 web_search 自动不挂)
    'web_search',
    'web_fetch',
  ];

  /** gallery-caption-writer 入口的工具集(画廊图说场景)。 */
  private static readonly GALLERY_CAPTION_TOOLS = [
    'get_current_draft', // 画廊版:读清单+随笔(装配层按 gallery 场景换实现)
    'view_photos', // 申请看图(后端 prepareStep 注图)
    'propose_caption', // 写/改单张图说
  ];

  /**
   * report-analyst 入口:简报阅读页追问 sub-agent。
   * 设计:简报全篇(完整 markdown + findings 含 reason/snippet)通过 <digest_report>
   * system 段全篇注入(prompt.handler 自动拼,不走工具),所以 sub-agent 自带"全局视野"。
   * 工具只给联网两件套——简报是 snapshot,聊起来一定会延伸到外面新信息;给 Aurora 一个出口。
   *
   * 管理员可在 UI 修改 systemPrompt 与 tools,启动不会覆盖已有记录(补齐策略:只补缺失 key)。
   */
  /**
   * 报告分析师预置入口工厂方法(原 static readonly 常量 → 工厂方法)。
   * 原因:systemPrompt 现在从 settings/digest-report-analyst.md 读取,
   * 需要 promptManager 实例,无法在静态属性初始化时调用。
   * 在 onModuleInit 里调用此方法生成完整配置对象,保持同一份定义不重复。
   */
  private getReportAnalystEntry(): typeof SystemConfigService.REPORT_ANALYST_ENTRY_SHAPE {
    return {
      key: 'report-analyst',
      name: '报告分析师',
      description: '帮用户深挖简报内容，追问细节与论点',
      enabled: true,
      // 从 settings/digest-report-analyst.md 加载默认 system prompt(原散落字符串 → promptManager 统一托管)
      // 这是初始默认值,写入 Mongo 后用户可在 UI 修改;重启不会覆盖已有 DB 记录(补齐策略:只补缺失 key)
      systemPrompt: this.promptManager.render(
        'settings/digest-report-analyst.md',
      ),
      // 简报本身全篇注入(报告 markdown + findings 完整字段直接进 system prompt),
      // 给 browse(浏览订阅源最新 7 天) + web_search(任意搜) + web_fetch(读 URL 全文)。
      // sub-agent 不需要"读内容"类的工具;这套覆盖"我订阅源还有啥/外面还有啥/这篇细节"3 个场景。
      tools: ['browse', 'web_search', 'web_fetch'],
      tier: 'standard',
      providerId: '',
      flashProviderId: '',
      standardProviderId: '',
      thinkProviderId: '',
      visionProviderId: '',
      enabledSkillIds: [],
    };
  }

  /** 用于 getReportAnalystEntry 返回类型推断的形状占位(TypeScript 不支持从方法本体推断) */
  private static readonly REPORT_ANALYST_ENTRY_SHAPE = {
    key: '',
    name: '',
    description: '',
    enabled: true,
    systemPrompt: '',
    tools: [] as string[],
    tier: '',
    providerId: '',
    flashProviderId: '',
    standardProviderId: '',
    thinkProviderId: '',
    visionProviderId: '',
    enabledSkillIds: [] as string[],
  };

  /** gallery-caption-writer 的预置入口(预置与补齐共用一份,避免两处手抄)。 */
  private static readonly GALLERY_CAPTION_ENTRY = {
    key: 'gallery-caption-writer',
    name: '图说写手',
    description: '为画廊照片写/改图说(caption)',
    enabled: true,
    systemPrompt:
      // 极其克制是沉浸式画廊的核心。30 字一句白描点睛,工具会硬拒超长。
      '写图说(caption)的手感:**30 字以内**,一句白描点睛即可。短、具体、贴着画面本身和那篇随笔的气口;' +
      '别堆形容词、别说正确的废话——一句平实的话就够。超过 30 字工具会拒,再长再美也没用。' +
      '你用 propose_caption 给的图说只是**提议**,要用户在卡片上点「应用」才生效——所以别说「已更新/已改好」,要说「我提议了…,满意就点应用」。',
    tools: [...SystemConfigService.GALLERY_CAPTION_TOOLS],
    tier: 'vision',
    providerId: '',
    flashProviderId: '',
    standardProviderId: '',
    thinkProviderId: '',
    visionProviderId: '',
    enabledSkillIds: [],
  };

  constructor(
    private readonly repo: SystemConfigRepository,
    private readonly contentRepoService: ContentRepoService,
    // SkillService:配置 agent 时硬校验 skill.requiredTools ⊆ agent.tools(spec §4.3),
    // 同时 saveAgentConfig 前自动清理因 tool 移除而失效的 enabledSkillIds(Task 0.7)。
    private readonly skillService: SkillService,
    // PromptManagerService 是 @Global() 注入,无需 module import
    // 用于在 onModuleInit 时从 settings/digest-report-analyst.md 渲染默认 system prompt
    private readonly promptManager: PromptManagerService,
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
            providerId: '',
            flashProviderId: '',
            standardProviderId: '',
            thinkProviderId: '',
            visionProviderId: '',
            enabledSkillIds: [],
          },
          { ...SystemConfigService.GALLERY_CAPTION_ENTRY },
          { ...this.getReportAnalystEntry() },
        ] as AgentEntryConfig[],
      });
      this.logger.log(
        '预置 writing-advisor + gallery-caption-writer + report-analyst agent 配置已写入',
      );
    } else {
      // 退役工具清理：只删"确已下线、代码里已无对应工厂"的死工具名,不碰用户的有效选择。
      //
      // 2026-06-04 起**不再"补齐新增工具"**:旧逻辑把"用户主动删掉的工具"当成"缺失",
      // 每次启动 push 回去并写库 —— 等于重启就偷偷撤销用户的删除(排查改稿停用时定位的真坑:
      // 用户删 propose_document_rewrite,一部署重启又被补回)。代价是新工具不再自动下发到已有
      // agent,改由管理员在工具池 UI 手动勾选 —— 既然已有工具池 UI,自动补回本就该退役。
      const wa = config?.agentConfigs?.find((c) => c.key === 'writing-advisor');
      if (wa) {
        // 退役的 v2 工具名：rewrite_selection(Task 8 前已删)、rewrite_reference/rewrite_document(Task 9 退役)
        const retiredTools = [
          'rewrite_selection',
          'rewrite_reference',
          'rewrite_document',
        ];
        const removed = wa.tools.filter((t) => retiredTools.includes(t));
        if (removed.length > 0) {
          wa.tools = wa.tools.filter((t) => !retiredTools.includes(t));
          await this.repo.patch({ agentConfigs: config.agentConfigs });
          this.logger.log(
            `writing-advisor 清理退役工具: ${removed.join(', ')}`,
          );
        }
      }

      // 补齐 gallery-caption-writer:老库只有 writing-advisor,需补这个新入口
      if (
        !config.agentConfigs.some((c) => c.key === 'gallery-caption-writer')
      ) {
        config.agentConfigs.push({
          ...SystemConfigService.GALLERY_CAPTION_ENTRY,
        });
        await this.repo.patch({ agentConfigs: config.agentConfigs });
        this.logger.log('补齐 gallery-caption-writer agent 配置');
      }

      // 补齐 report-analyst:简报阅读页追问 agent(2026-06-20 新增)
      if (!config.agentConfigs.some((c) => c.key === 'report-analyst')) {
        config.agentConfigs.push({
          ...this.getReportAnalystEntry(),
        });
        await this.repo.patch({ agentConfigs: config.agentConfigs });
        this.logger.log('补齐 report-analyst agent 配置');
      }

      // Tools migration: 历史上 REPORT_ANALYST_ENTRY.tools 曾是 [](注明"纯对话无工具"),
      // 但 tool.assembler 的 bug 让 [] 等价于全工具,Aurora 答"先读草稿" → 调 get_current_draft。
      // bug 修了后 [] 真的是 0 工具,Aurora 答应"去搜"实际啥工具都没,只能 hallucinate。
      // 一次性写默认 ['browse','web_search','web_fetch']。已被 admin 显式改过(非空)的不动。
      const ra = config.agentConfigs.find((c) => c.key === 'report-analyst');
      if (ra && (!ra.tools || ra.tools.length === 0)) {
        ra.tools = ['browse', 'web_search', 'web_fetch'];
        await this.repo.patch({ agentConfigs: config.agentConfigs });
        this.logger.log(
          'Migration: report-analyst.tools 由空补成 [browse, web_search, web_fetch]',
        );
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
        hasTavilyApiKey: !!config?.tavilyApiKey,
      },
      ai: {
        providers: (config?.aiProviders ?? []).map((p) => ({
          id: p.id,
          provider: p.provider,
          name: p.name,
          flashModel: p.flashModel,
          standardModel: p.standardModel,
          thinkModel: p.thinkModel,
          visionModel: p.visionModel ?? '',
          contextWindow: p.contextWindow ?? 0,
          hasApiKey: !!p.apiKey,
        })),
        activeProviderId: config?.activeAiProviderId || '',
        aiSystemPrompt: config?.aiSystemPrompt || '',
      },
      // Agent 入口配置:类型同源 AgentEntryConfig(F4-c),直接整条透出无脱敏。
      // 不再手抄字段子集 —— 避免漏字段(以前漏了 4 providerId + enabledSkillIds)。
      agent: {
        configs: config?.agentConfigs ?? [],
      },
      // 所有者身份信息
      owner: {
        name: config?.ownerProfile?.name || '',
        birthday: config?.ownerProfile?.birthday || '',
        bio: config?.ownerProfile?.bio || '',
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

  async saveIntegrationConfig(input: {
    mineruToken?: string;
    tavilyApiKey?: string;
  }): Promise<void> {
    const fields: Record<string, string> = {};
    if (input.mineruToken !== undefined) {
      fields.mineruToken = input.mineruToken;
      process.env.MINERU_TOKEN = input.mineruToken;
    }
    if (input.tavilyApiKey !== undefined) {
      fields.tavilyApiKey = input.tavilyApiKey;
      process.env.TAVILY_API_KEY = input.tavilyApiKey;
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
    /** 视觉模型,可选(创建时一般不填,后续在 UI 补) */
    visionModel?: string;
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
      visionModel: input.visionModel ?? '',
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
      visionModel?: string;
      apiKey?: string;
      contextWindow?: number;
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
        // 视觉可选:undefined 不动,'' 表示显式清空
        ...(fields.visionModel !== undefined
          ? { visionModel: fields.visionModel }
          : {}),
        ...(fields.apiKey !== undefined ? { apiKey: fields.apiKey } : {}),
        ...(fields.contextWindow !== undefined
          ? { contextWindow: fields.contextWindow }
          : {}),
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
    /**
     * 已解析的 providerId(2026-05-31 改造,#143)。调用方(AgentService)按 tier
     * 从 agentConfig 取对应字段——
     *   flashProviderId / standardProviderId / thinkProviderId / visionProviderId
     * 任一为空回退到 agentConfig.providerId,再回退到全局 activeAiProviderId。
     * 此函数只负责按已解析的 providerId 拼 baseUrl/apiKey/model;不做 fallback。
     */
    providerId?: string,
  ): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    aiSystemPrompt: string;
    /** 模型上下文窗口(token):compaction 占比触发与上下文组装的分母。无配置时回退 32000。 */
    contextWindow: number;
  }> {
    const config = await this.repo.get();
    const resolvedId = providerId || config?.activeAiProviderId || '';
    const active = (config?.aiProviders ?? []).find((p) => p.id === resolvedId);

    // 根据 tier 选择对应的模型名
    let model = '';
    if (active) {
      if (tier === 'flash') model = active.flashModel;
      else if (tier === 'think') model = active.thinkModel;
      else if (tier === 'vision')
        model = active.visionModel ?? ''; // 画廊用;未配则空,调用方自行处理"无视觉"
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
  }> {
    const config = await this.repo.get();
    return {
      name: config?.ownerProfile?.name || '',
      birthday: config?.ownerProfile?.birthday || '',
      bio: config?.ownerProfile?.bio || '',
    };
  }

  /** 保存所有者身份信息（partial update） */
  async saveOwnerProfile(input: {
    name?: string;
    birthday?: string;
    bio?: string;
  }): Promise<void> {
    const config = await this.repo.get();
    const existing = config?.ownerProfile || {
      name: '',
      birthday: '',
      bio: '',
    };
    await this.repo.patch({
      ownerProfile: {
        name: input.name ?? existing.name,
        birthday: input.birthday ?? existing.birthday,
        bio: input.bio ?? existing.bio,
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
   * 返回所有可用工具池(供 AgentTab 在 UI 上用 checkbox 渲染),合并两个内置入口的
   * 工具集去重。前端按此池子让用户勾选,不再允许自由 input 任意字符串
   * (避免拼写错落库,agent 启动时静默忽略)。
   */
  getAvailableTools(): string[] {
    const all = [
      ...SystemConfigService.WRITING_ADVISOR_TOOLS,
      ...SystemConfigService.GALLERY_CAPTION_TOOLS,
    ];
    return Array.from(new Set(all));
  }

  /**
   * 保存 agent 入口配置（upsert by key）。
   * key 已存在则合并更新，不存在则追加到数组末尾。
   *
   * Skill 关联校验/清理(spec §4.3 + §6.3,Task 0.5/0.7 + 2026-06-03 review F3 收紧):
   *
   * 分两条路径,**取决于 input.enabledSkillIds 是否提供**(undefined 还是显式数组):
   *
   * 【路径 A】input.enabledSkillIds === undefined
   *   用户没动 enabledSkillIds 这个字段(通常只改 tools / name 等)。
   *   整套 existing.enabledSkillIds 走 autoCleanup:tools 改了可能孤儿化,静默剔除,
   *   cleaned 透回让前端 toast。不做 strict validate(用户没主动 opt-in 新 skill)。
   *
   * 【路径 B】input.enabledSkillIds 提供了(包括空数组 — 视作"用户在管理这个列表")
   *   把 input.enabledSkillIds 拆成两个子集:
   *     - inherited = input ∩ existing.enabledSkillIds (用户没删的旧 skill)
   *     - added     = input \ existing.enabledSkillIds (本次新加 — 用户主动 opt-in)
   *   分别处理:
   *     - inherited 走 autoCleanup:tools 也可能跟着改,旧 skill 可能孤儿化,
   *       静默剔除 + cleaned 透回(行为同路径 A)。
   *     - added     走 strict validate:不存在 / 缺工具 → 400 BadRequest。
   *       用户主动加的不合规必须让他看见(spec §6.3 — 不静默吞 added 的问题)。
   *   最终 enabledSkillIds = cleanedInherited ∪ validatedAdded。
   *
   *   顺序:**先 validate added 再 cleanup inherited**。added 不合规时直接抛 400,
   *   inherited 也不会被处理,merged 也不入库 — 行为干净。
   *
   * 写库时机:cleanup + validate 全通过后才 patch;校验失败抛 400,merged 不入库。
   * 用函数式 next = existing.map(...) 构造而非 mutate existing[idx],避免任何一步抛错时
   * existing 数组已被改坏(下次 repo.get 拿到的 in-memory cache 可能受影响)。
   *
   * 返回:{ cleaned } —— autoCleanup 触发的孤儿 skill 列表(给前端 toast)。
   */
  async saveAgentConfig(
    key: string,
    input: Partial<Omit<AgentEntryConfig, 'key'>>,
  ): Promise<{ cleaned: Array<{ agent: string; skillName: string }> }> {
    const config = await this.repo.get();
    const existing = config?.agentConfigs ?? [];
    const idx = existing.findIndex((c) => c.key === key);
    // 在 merge 前留住"用户传入的 enabledSkillIds 原始值",分流靠它
    // (merge 后 merged.enabledSkillIds 就丢了"input 是否提供过"这一信号)
    const existingEntry = idx >= 0 ? existing[idx] : null;
    const existingSkillIds = existingEntry?.enabledSkillIds ?? [];

    let merged: AgentEntryConfig;
    if (existingEntry) {
      // 更新已有条目:只覆盖传入字段
      merged = { ...existingEntry, ...input, key };
    } else {
      // 新增条目,补齐默认值(含 enabledSkillIds 默认 [])
      merged = {
        key,
        name: input.name ?? key,
        description: input.description ?? '',
        enabled: input.enabled ?? true,
        systemPrompt: input.systemPrompt ?? '',
        tools: input.tools ?? [],
        tier: input.tier ?? 'standard',
        providerId: input.providerId ?? '',
        flashProviderId: input.flashProviderId ?? '',
        standardProviderId: input.standardProviderId ?? '',
        thinkProviderId: input.thinkProviderId ?? '',
        visionProviderId: input.visionProviderId ?? '',
        enabledSkillIds: input.enabledSkillIds ?? [],
      };
    }

    // 分流:input 是否显式传了 enabledSkillIds
    let cleaned: Array<{ agent: string; skillName: string }>;
    if (input.enabledSkillIds === undefined) {
      // 路径 A:用户没动 enabledSkillIds → 全套老列表走 autoCleanup(tools 可能改了)
      // merged.enabledSkillIds 此时 === existingEntry.enabledSkillIds(或新建时 [])
      cleaned = await this.autoCleanupOrphanSkills(merged);
    } else {
      // 路径 B:用户在管理这个列表 → 拆 inherited/added 区分对待
      const existingSet = new Set(existingSkillIds);
      // 去重(用户偶尔传重复 id);保序按 input 原顺序
      const seen = new Set<string>();
      const dedupedInput: string[] = [];
      for (const id of input.enabledSkillIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        dedupedInput.push(id);
      }
      const inherited = dedupedInput.filter((id) => existingSet.has(id));
      const added = dedupedInput.filter((id) => !existingSet.has(id));

      // 先 validate added(不合规直接 400,inherited 不必处理,merged 不入库)
      if (added.length > 0) {
        await this.validateSkillsStrict(merged, added);
      }

      // 再 cleanup inherited:tools 也可能跟着改,旧 skill 可能孤儿化,静默剔除
      let cleanedInherited: string[] = inherited;
      cleaned = [];
      if (inherited.length > 0) {
        // 临时把 merged.enabledSkillIds 设为 inherited 跑 cleanup,拿回 kept + cleaned
        merged.enabledSkillIds = inherited;
        cleaned = await this.autoCleanupOrphanSkills(merged);
        cleanedInherited = merged.enabledSkillIds; // cleanup 内部已 mutate
      }

      // 合并最终列表:cleanedInherited(剔掉孤儿)+ added(已严格校验)
      merged.enabledSkillIds = [...cleanedInherited, ...added];
    }

    // 全通过 → 函数式构造 next 数组,patch 写库。失败抛 400 时 existing 未被 mutate。
    const next = existingEntry
      ? existing.map((c, i) => (i === idx ? merged : c))
      : [...existing, merged];

    await this.repo.patch({ agentConfigs: next });
    this.logger.log(`Agent config saved: ${key}`);
    return { cleaned };
  }

  /**
   * 自动清理孤儿 skill(Task 0.7):
   * 遍历 agent.enabledSkillIds,凡 skill.requiredTools 不再 ⊆ agent.tools 的从列表移除。
   *
   * 直接 mutate 传入的 agent.enabledSkillIds(已是 saveAgentConfig 中的 merged 引用)。
   * 已被删的 skill(Mongo 查不到)也丢弃,但 cleanup 事件链通常已先把它清掉,
   * 这里只是兜底(防止事件丢失)。
   *
   * 返回被清理掉的 skill 信息列表,供前端 toast 展示用户警告。
   *
   * 性能:用 findByIds 一次批量拉(替代 N 次串行 findById),配 enabledSkillIds 可能上 10
   * 时差距明显;findByIds 已在 SkillRepository 提供。
   */
  private async autoCleanupOrphanSkills(
    agent: AgentEntryConfig,
  ): Promise<Array<{ agent: string; skillName: string }>> {
    const skillIds = agent.enabledSkillIds ?? [];
    if (!skillIds.length) return [];

    // 一次批量拉(避免 N+1):内存里按 id Map 校验
    const found = await this.skillService.findByIds(skillIds);
    const byId = new Map(
      found.map((s) => [String((s as { _id?: unknown })._id), s]),
    );

    const cleaned: Array<{ agent: string; skillName: string }> = [];
    const kept: string[] = [];

    for (const skillId of skillIds) {
      const skill = byId.get(skillId);
      if (!skill) {
        // skill 已被删 → 直接丢弃(无 displayName 可报,记日志即可)
        this.logger.warn(
          `agent ${agent.key} 持有已删除 skill 引用 ${skillId},兜底清理`,
        );
        continue;
      }
      const allRequiredPresent = (skill.requiredTools ?? []).every((t) =>
        agent.tools.includes(t),
      );
      if (allRequiredPresent) {
        kept.push(skillId);
      } else {
        cleaned.push({ agent: agent.key, skillName: skill.name });
        this.logger.warn(
          `agent ${agent.key} 移除工具导致 skill ${skill.name} 自动 disable`,
        );
      }
    }

    agent.enabledSkillIds = kept;
    return cleaned;
  }

  /**
   * 对 added 子集做严格校验:skill 必须存在 且 requiredTools ⊆ agent.tools。
   * 违反 → 400 BadRequest,保存动作整体 reject。
   *
   * 用途:saveAgentConfig 路径 B 中,用户本次主动新加(opt-in)的 skill 必须合规;
   * 不存在或缺工具不能静默吞,要让用户在 UI 看到 toast/对话框(spec §6.3)。
   *
   * 跟旧的 validateEnabledSkills 的差别:
   *   - 旧:校验 agent.enabledSkillIds 整集 → 把"老 skill 因 tools 改而孤儿"也一并 400,
   *         体验差(用户没动 skill 还被卡)。
   *   - 新:只校验 added 子集(本次新加) → inherited 那些孤儿走 autoCleanup 静默剔除。
   *
   * 性能:一次 findByIds 批量拉,避免 N 次串行。
   */
  private async validateSkillsStrict(
    agent: AgentEntryConfig,
    skillIds: string[],
  ): Promise<void> {
    if (!skillIds.length) return;

    const found = await this.skillService.findByIds(skillIds);
    const byId = new Map(
      found.map((s) => [String((s as { _id?: unknown })._id), s]),
    );

    for (const skillId of skillIds) {
      const skill = byId.get(skillId);
      if (!skill) {
        throw new BadRequestException(
          `Agent ${agent.key} 启用了不存在的 skill: ${skillId}`,
        );
      }
      const missing = (skill.requiredTools ?? []).filter(
        (t) => !agent.tools.includes(t),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Agent ${agent.key} 启用的 skill "${skill.name}" 缺工具: ${missing.join(', ')}`,
        );
      }
    }
  }

  /** 按 key 查找 agent 入口配置（供 AgentService 调用） */
  async getAgentConfig(key: string): Promise<AgentEntryConfig | null> {
    const config = await this.repo.get();
    return config?.agentConfigs?.find((c) => c.key === key) ?? null;
  }

  /**
   * 监听 Skill 删除事件,清除所有 agentConfigs.enabledSkillIds 里对该 skill 的引用。
   *
   * 解耦设计(Task 0.6):
   *   - SkillService 删完 emit 'skill.deleted'(EventEmitter2 全局总线)
   *   - 这里监听处理,避免 SkillModule <-> SettingsModule 双向 import 循环
   *   - 直接走 repo.patch,跳过 saveAgentConfig 的 validateEnabledSkills
   *     —— 移除引用是减法,移除后 enabledSkillIds 必然合规
   *
   * 错误处理(2026-06-03 review F2):
   *   - 整个 handler 包 try-catch:EventEmitter 是 fire-and-forget,
   *     handler 抛出会变 unhandledRejection,污染进程;且 SkillService.delete 已经返回,
   *     回滚为时已晚(skill 实体已不在库里)。所以只 logger.error 带 stack + skillId,
   *     不 rethrow。
   *   - 真出问题(Mongo 瞬时挂掉)→ 日志告警 + 监控,运维去处理;数据不一致下次 agent 配置
   *     保存时,autoCleanupOrphanSkills 会再清一遍兜底。
   *
   * spec §9「enabledSkill 引用 deleted skill」风险应对。
   */
  @OnEvent(SKILL_DELETED_EVENT)
  async cleanupSkillReferences(event: SkillDeletedEvent): Promise<void> {
    try {
      const config = await this.repo.get();
      if (!config?.agentConfigs?.length) return;

      let touchedAgents = 0;
      const next = config.agentConfigs.map((agent) => {
        const ids = agent.enabledSkillIds ?? [];
        const filtered = ids.filter((id) => id !== event.skillId);
        if (filtered.length === ids.length) return agent;
        touchedAgents += 1;
        return { ...agent, enabledSkillIds: filtered };
      });

      if (touchedAgents > 0) {
        await this.repo.patch({ agentConfigs: next });
        this.logger.log(
          `skill ${event.skillId} 引用从 ${touchedAgents} 个 agent 自动清理`,
        );
      }
    } catch (err) {
      // fire-and-forget handler:这里不 rethrow,否则会变 unhandledRejection。
      // 带 stack + skillId 供排错;兜底由后续 saveAgentConfig.autoCleanup 兜住。
      this.logger.error(
        `cleanupSkillReferences 失败 skillId=${event.skillId}: 该 skill 引用可能未从 agent 配置清除`,
        err instanceof Error ? err.stack : String(err),
      );
    }
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
    tavilyApiKey?: string;
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
    if (config.tavilyApiKey) process.env.TAVILY_API_KEY = config.tavilyApiKey;
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
