/**
 * InfoSource — 信息源实体（智能小应用·自动信息收集）。
 *
 * 全局共用资源：一个 source 可以被多个 SmartTopicConfig 订阅，减少重复抓取。
 * type 是 discriminator，config 字段按 type 解释（rss: {url}; webpage: {url, selector}…）。
 * 首期实现 RSS，其余 type 字段已预留 enum 但 service 暂不实现，撞到了再补。
 *
 * 业务 id 用 src_xxx（randomUUID 截 12 位），跟 ci_xxx / stc_xxx 风格统一，
 * 日志里读得出是什么对象。
 *
 * category（Task #40）：给信息源打分类标签，驱动前端"按分类选源"UI（Task #43/#44）。
 * 老数据无 category 字段，onModuleInit migrate 时统一补 'engineering' 作为兜底默认值。
 *
 * 分类精简（refactor）：7 类 → 5 类（ai/engineering/business/design/longform），
 * 不再按国内/国外区分，按主题归位；academic 归 ai（seed 论文全是 AI 相关 arXiv）。
 * onModuleInit Step 1b 负责把数据库里残留的旧 enum 值 map 到新值。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { FetcherKind } from './fetchers/fetcher.interface';

export enum InfoSourceType {
  rss = 'rss',
  webpage = 'webpage',
  api = 'api',
  mailbox = 'mailbox',
}

export enum FetchStatus {
  ok = 'ok',
  failed = 'failed',
}

/**
 * 信息源分类枚举 — 对应 source-seeds.ts 里的 SEED_SOURCES 清单。
 * 5 类：按主题严格划分，不区分国内/国外，不留废弃旧值。
 */
export enum InfoSourceCategory {
  ai = 'ai',
  engineering = 'engineering',
  business = 'business',
  design = 'design',
  longform = 'longform',
}

@modelOptions({
  schemaOptions: { collection: 'info_sources' },
  options: { allowMixed: Severity.ALLOW },
})
export class InfoSource {
  @prop({ required: true, trim: true })
  _id!: string;

  @prop({ enum: InfoSourceType, required: true, index: true })
  type!: InfoSourceType;

  /**
   * Fetcher 路由 key（Fetcher 插件架构 v2，2026-06-21 引入）。
   *
   * type 是早期 4 大类 discriminator（rss/webpage/api/mailbox），粒度太粗 —
   * 实测 23 个源里 13 个非 RSS（arxiv API / HN Firebase / 掘金 POST / 知乎日报 /
   * GitHub Trending HTML / sitemap scrape），单靠 type 没法路由到具体抓取实现。
   *
   * fetcherKind 就是 FetcherRegistry 真正用的 key，对应 11 种 Fetcher 实现。
   * 老数据由 onModuleInit Step 1c 兜底：type='rss' → fetcherKind='rss'。
   */
  // type: String 必填——SWC builder(nest.js start --builder swc)不生成
  // reflect-metadata,typegoose 没法从外部 import 的 enum 推断字段 type,
  // 启动直接 InvalidTypeError E009。同文件内的 InfoSourceCategory 推断走得通是
  // 因为同文件类型信息可见。这条与代理/网络无关,纯 SWC 限制。
  @prop({
    type: String,
    enum: FetcherKind,
    required: true,
    default: FetcherKind.rss,
    index: true,
  })
  fetcherKind!: FetcherKind;

  @prop({ required: true, trim: true })
  name!: string;

  /** 按 type discriminator 解释 — rss: { url }; webpage: { url, selector }; api: { url, method, headers, body }; mailbox: { imapHost, user, … }。
   *  用 Mixed 是因为不同 type 字段差异大，统一 schema 反而绑死；校验放在 DTO 层做。 */
  @prop({ type: () => Object, required: true })
  config!: Record<string, unknown>;

  @prop({ required: true, default: true })
  enabled!: boolean;

  @prop({ type: () => Date })
  lastFetchedAt?: Date;

  @prop({ enum: FetchStatus })
  lastFetchStatus?: FetchStatus;

  @prop({ trim: true })
  lastFetchError?: string;

  /** 分类标签（Task #40）：驱动"按分类选源"UI；老数据由 onModuleInit migrate 补 'engineering'。 */
  @prop({
    enum: InfoSourceCategory,
    required: true,
    default: InfoSourceCategory.engineering,
    index: true,
  })
  category!: InfoSourceCategory;

  /**
   * 一句话简介，给 agent 看（在 system prompt 里展示），帮助判断该源适合啥主题。
   * seed 源在 source-seeds.ts 里预设，admin 手动创建的源可选填。
   */
  @prop({ trim: true })
  description?: string;

  /** 展示排序权重，越小越靠前；seed 源不设此值，UI 按 category + name 自然排序。 */
  @prop({ type: () => Number })
  displayOrder?: number;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ type: () => Date })
  updatedAt?: Date;
}
