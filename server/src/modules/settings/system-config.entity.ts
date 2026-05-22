import { modelOptions, prop, Severity } from '@typegoose/typegoose';

/**
 * AgentEntryConfig — Agent 入口配置（子文档）。
 *
 * 存在 SystemConfig.agentConfigs 数组中，以 key 字段区分不同入口。
 * 每个入口独立控制：启用状态、system prompt、工具集、默认模型层级。
 */
@modelOptions({ schemaOptions: { _id: false } })
export class AgentEntryConfig {
  /** 唯一标识，如 "writing-advisor" */
  @prop({ required: true, trim: true })
  key!: string;

  /** 显示名称，如 "写作顾问" */
  @prop({ required: true, trim: true })
  name!: string;

  /** 一句话描述 */
  @prop({ trim: true, default: '' })
  description!: string;

  /** 是否启用 */
  @prop({ default: true })
  enabled!: boolean;

  /** 自定义 system prompt，为空时 agent 使用默认角色定义 */
  @prop({ trim: true, default: '' })
  systemPrompt!: string;

  /** 启用的工具名列表 */
  @prop({ type: () => [String], default: [] })
  tools!: string[];

  /** 默认模型层级：flash / standard / think */
  @prop({ trim: true, default: 'standard' })
  tier!: string;
}

/**
 * AI 提供商配置（子文档，存在 SystemConfig.aiProviders 数组中）。
 *
 * 每个提供商绑定三个 tier 的模型名：
 * - flash：快速问答、简单任务
 * - standard：日常写作顾问（默认）
 * - think：复杂分析、长文推理
 *
 * 用户在 Settings 添加提供商时，从提供商 API 拉取模型列表，
 * 自行为三个 tier 各选一个模型。后续可随时编辑。
 */
@modelOptions({ schemaOptions: { _id: false } })
export class AiProviderConfig {
  /** 唯一标识，nanoid(8) */
  @prop({ required: true, trim: true })
  id!: string;

  /** 提供商标识：deepseek / zhipu / moonshot */
  @prop({ required: true, trim: true })
  provider!: string;

  /** 显示名称，如 "DeepSeek" */
  @prop({ required: true, trim: true })
  name!: string;

  /** API 地址，如 https://api.deepseek.com（后端根据 provider 自动填） */
  @prop({ required: true, trim: true })
  baseUrl!: string;

  /** API 密钥 */
  @prop({ required: true, trim: true })
  apiKey!: string;

  /** 闪电级模型名 */
  @prop({ required: true, trim: true })
  flashModel!: string;

  /** 标准级模型名 */
  @prop({ required: true, trim: true })
  standardModel!: string;

  /** 深思级模型名 */
  @prop({ required: true, trim: true })
  thinkModel!: string;
}

/** 受信任设备条目 */
export class TrustedDevice {
  @prop({ required: true, trim: true })
  token!: string;

  /** 设备名称（从 User-Agent 解析） */
  @prop({ trim: true, default: '' })
  name!: string;

  @prop({ trim: true, default: '' })
  userAgent!: string;

  @prop({ required: true, type: () => Date })
  trustedAt!: Date;

  @prop({ type: () => Date })
  lastUsedAt?: Date;
}

/**
 * OwnerProfile — 所有者身份信息（子文档）。
 *
 * 存在 SystemConfig.ownerProfile 中，整个系统只有一个所有者。
 * Agent 通过 system prompt 注入所有者身份，知道在跟谁对话。
 */
@modelOptions({ schemaOptions: { _id: false } })
export class OwnerProfile {
  /** 所有者昵称 */
  @prop({ trim: true, default: '' })
  name!: string;

  /** 生日（如"2000-01-15"或"1月15日"） */
  @prop({ trim: true, default: '' })
  birthday!: string;

  /** 个人简介（基础能力，如"前端开发、摄影、写作"） */
  @prop({ trim: true, default: '' })
  bio!: string;

  /** 关注领域（如"计算机科学、文学、城市骑行"） */
  @prop({ trim: true, default: '' })
  interests!: string;
}

/**
 * SystemConfig — 系统配置单例文档。
 *
 * 使用固定 _id = 'singleton' 实现单例模式（findOneAndUpdate + upsert）。
 * 分区：sync（远端+Git）、integration（MinerU + 未来模型 API）。
 * OSS 配置走环境变量，不入 MongoDB。
 */
@modelOptions({
  schemaOptions: { collection: 'system_config' },
  options: { allowMixed: Severity.ERROR },
})
export class SystemConfig {
  @prop({ required: true, default: 'singleton' })
  _id!: string;

  // ── 同步（远端仓库 + Git） ──

  @prop({ trim: true, default: '' })
  remoteUrl!: string;

  @prop({ trim: true, default: '' })
  gitToken!: string;

  @prop({ trim: true, default: '' })
  gitAuthorName!: string;

  @prop({ trim: true, default: '' })
  gitAuthorEmail!: string;

  /** 自动推送 cron 表达式，默认每天凌晨 3 点 */
  @prop({ trim: true, default: '' })
  gitSyncCron!: string;

  // ── 安全 ──

  /** bcrypt hash，用户通过 UI 改密码后持久化 */
  @prop({ trim: true, default: '' })
  passwordHash!: string;

  /** 受信任设备列表 */
  @prop({ type: () => [TrustedDevice], default: [], _id: false })
  trustedDevices!: TrustedDevice[];

  // ── 集成 ──

  @prop({ trim: true, default: '' })
  mineruToken!: string;

  // ── AI ──

  /**
   * AI 提供商配置列表。
   * 每个条目对应一个 LLM 提供商（含 API Key + 三级模型绑定），支持配置多个并切换启用。
   */
  @prop({ type: () => [AiProviderConfig], default: [], _id: false })
  aiProviders!: AiProviderConfig[];

  /** 当前启用的提供商配置 ID */
  @prop({ trim: true, default: '' })
  activeAiProviderId!: string;

  /** 用户自定义 system prompt 补充（全局，追加到默认角色定义后） */
  @prop({ trim: true, default: '' })
  aiSystemPrompt!: string;

  // ── 所有者身份 ──

  /** 所有者个人信息（昵称、简介），Agent 会在 system prompt 中读取 */
  @prop({ type: () => OwnerProfile, _id: false })
  ownerProfile?: OwnerProfile;

  // ── Agent 入口配置 ──

  /**
   * Agent 入口配置列表。
   * 每个条目对应一个 agent 入口（含 key、名称、工具集、tier 等），
   * 前端通过 Settings > Agent tab 管理。
   */
  @prop({ type: () => [AgentEntryConfig], default: [], _id: false })
  agentConfigs!: AgentEntryConfig[];

  @prop({ type: () => Date })
  updatedAt?: Date;
}
