import { modelOptions, prop, Severity } from '@typegoose/typegoose';

export enum ContentStatus {
  committed = 'committed',
  published = 'published',
  archived = 'archived',
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
  /** 创建后第一次提交前为空字符串，提交后填入真实 git commitHash */
  @prop({ trim: true, default: '' })
  commitHash!: string;

  @prop({ required: true, trim: true })
  title!: string;

  @prop({ trim: true })
  summary?: string;
}

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

  @prop({ type: () => [ContentChangeLog], default: [] })
  changeLogs!: ContentChangeLog[];

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;

  @prop({ trim: true })
  createdBy?: string;

  @prop({ trim: true })
  updatedBy?: string;

  get id(): string {
    return this._id;
  }
}
