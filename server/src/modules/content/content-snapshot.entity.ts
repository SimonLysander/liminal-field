/**
 * ContentSnapshot — 版本快照实体，独立于 ContentItem 存储。
 *
 * 每次业务提交创建一个 snapshot，存储该版本的完整 bodyMarkdown。
 * 独立集合避免 ContentItem 文档膨胀（500篇 × 20版本 × 50KB = ~500MB）。
 */
import { modelOptions, prop, Severity, index } from '@typegoose/typegoose';

@index({ contentItemId: 1, createdAt: -1 })
@modelOptions({
  schemaOptions: { collection: 'content_snapshots' },
  options: { allowMixed: Severity.ERROR },
})
export class ContentSnapshot {
  /** versionId — nanoid 生成，不依赖 Git commitHash */
  @prop({ required: true, trim: true })
  _id!: string;

  @prop({ required: true, trim: true, index: true })
  contentItemId!: string;

  @prop({ required: true, trim: true })
  title!: string;

  @prop({ trim: true, default: '' })
  summary!: string;

  /** 完整正文，与写入 Git 的 main.md 内容一致。新建时为空字符串。 */
  @prop({ default: '' })
  bodyMarkdown!: string;

  /** 该版本引用的资源文件名列表（用于不读 Git 时重建资源索引） */
  @prop({ type: () => [String], default: [] })
  assetRefs!: string[];

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ trim: true, default: '' })
  changeNote!: string;

  /**
   * 来源标识：区分谁/什么创建了这个版本。
   * 'user' | 'system' | 'ai' | 'import'，未设置视为 user。
   */
  @prop({ trim: true })
  source?: string;

  /** Git 异步回填，未完成时为 undefined */
  @prop({ trim: true })
  commitHash?: string;

  get versionId(): string {
    return this._id;
  }
}
