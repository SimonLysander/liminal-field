import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';

export enum ContentStatus {
  committed = 'committed',
  published = 'published',
}

export enum ContentChangeType {
  patch = 'patch',
  major = 'major',
}

export class ContentChangeLog {
  @prop({ trim: true })
  commitHash?: string;

  @prop({ trim: true })
  title?: string;

  @prop({ trim: true })
  summary?: string;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, enum: ContentChangeType })
  changeType!: ContentChangeType;

  @prop({ required: true, trim: true })
  changeNote!: string;
}

export class ContentVersion {
  /** V2: nanoid 版本标识，不依赖 Git；optional 保证旧文档向后兼容 */
  @prop({ trim: true })
  versionId?: string;

  /** 创建后第一次提交前为空字符串，提交后填入真实 git commitHash */
  @prop({ trim: true, default: '' })
  commitHash!: string;

  @prop({ required: true, trim: true })
  title!: string;

  @prop({ trim: true })
  summary?: string;
}

/**
 * 文集条目级发布状态：entryKey → 已发布的条目快照 versionId。
 *
 * 设计要点(2026-05 重构):发布是「业务/服务状态」,只存 MongoDB,**不进 Git**。
 * Git 只存内容+结构(main.md 的 entries 列表不再含 publishedVersionId)。
 * 因此恢复时本字段随 publishedVersion 一起清零 → 恢复后所有条目未发布,由用户手动重发
 * (或一键「发布全部最新版」)。这样从根上杜绝了「发布指针进 Git → 悬空 / 三份不一致」。
 * 仅 anthology 使用;notes/gallery 的发布状态用 publishedVersion 即可。
 */
export class EntryPublishState {
  @prop({ required: true, trim: true })
  entryKey!: string;

  /** 已发布的条目快照 versionId */
  @prop({ required: true, trim: true })
  publishedVersionId!: string;
}

// 覆盖 countPublished() 查询 { publishedVersion: { $ne: null } }
@index({ publishedVersion: 1 })
@modelOptions({
  schemaOptions: {
    collection: 'content_items',
  },
  options: { allowMixed: Severity.ERROR },
})
export class ContentItem {
  @prop({ required: true, trim: true })
  _id!: string;

  // Formal content now tracks two explicit version heads instead of mixing
  // visibility and version semantics into one top-level status field.
  // latestVersion is the newest committed head; publishedVersion is the public
  // pointer and only moves on Publish.
  @prop({ _id: false, type: () => ContentVersion })
  latestVersion?: ContentVersion;

  @prop({ _id: false, type: () => ContentVersion })
  publishedVersion?: ContentVersion | null;

  /**
   * 文集条目级发布状态(仅 anthology):只存 Mongo、不进 Git,恢复时清零。
   * 空数组 = 没有任何条目发布。详见 EntryPublishState 注释。
   */
  @prop({ _id: false, type: () => [EntryPublishState], default: [] })
  entryPublishStates?: EntryPublishState[];

  @prop({ type: () => [ContentChangeLog], default: [] })
  changeLogs!: ContentChangeLog[];

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;

  /** 首次发布时间，取消发布时清空 */
  @prop({ type: () => Date })
  publishedAt?: Date | null;

  @prop({ trim: true })
  createdBy?: string;

  @prop({ trim: true })
  updatedBy?: string;

  get id(): string {
    return this._id;
  }
}
