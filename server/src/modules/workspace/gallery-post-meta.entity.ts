/**
 * GalleryPostMeta 实体 — 存储在 gallery_post_meta MongoDB 集合。
 * 记录画廊帖子的 MongoDB 侧元数据：照片顺序/描述、封面图、标签。
 * 与 Git 存储的文件数据（asset 列表）在 GalleryViewService 中合并输出。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

/** 单张照片的元数据（顺序和描述）。 */
export class GalleryPhotoMeta {
  @prop({ required: true })
  fileName!: string;

  @prop({ default: '' })
  caption!: string;

  @prop({ required: true })
  order!: number;
}

@modelOptions({
  schemaOptions: { collection: 'gallery_post_meta', timestamps: true },
  options: { allowMixed: Severity.ALLOW },
})
export class GalleryPostMeta {
  /** 对应 ContentItem 的 ID，唯一索引，关联主键。 */
  @prop({ required: true, unique: true, index: true })
  contentItemId!: string;

  /** 照片元数据列表，默认为空数组。 */
  @prop({ type: () => [GalleryPhotoMeta], default: [] })
  photos!: GalleryPhotoMeta[];

  /** 封面图文件名，null 表示未手动指定（退化为首图）。 */
  @prop({ default: null })
  coverPhotoFileName!: string | null;

  /** 自定义标签，key-value 格式，用于前端筛选/展示。 */
  @prop({ type: () => Object, default: {} })
  tags!: Record<string, string>;

  createdAt!: Date;
  updatedAt!: Date;
}
