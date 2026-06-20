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
 * 老数据无 category 字段，onModuleInit migrate 时统一补 'tech' 作为兜底默认值。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

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

/** 信息源分类枚举 — 对应 source-seeds.ts 里的 SEED_SOURCES 清单。 */
export enum InfoSourceCategory {
  ai = 'ai',
  tech = 'tech',
  business = 'business',
  design = 'design',
  china_tech = 'china_tech',
  reading = 'reading',
  academic = 'academic',
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

  /** 分类标签（Task #40）：驱动"按分类选源"UI；老数据由 onModuleInit migrate 补 'tech'。 */
  @prop({
    enum: InfoSourceCategory,
    required: true,
    default: InfoSourceCategory.tech,
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
