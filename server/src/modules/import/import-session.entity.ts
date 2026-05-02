/**
 * ImportSession — 导入会话实体
 *
 * 跟踪文件导入的临时状态：解析结果、资源匹配进度。
 * 对应 MongoDB collection: import_sessions。
 * TTL 30 分钟，由 MongoDB TTL index 自动清理。
 */

import { modelOptions, prop } from '@typegoose/typegoose';

export class ImportAssetRef {
  @prop({ required: true })
  ref!: string;

  @prop({ required: true })
  filename!: string;

  @prop({ required: true, enum: ['missing', 'resolved'] })
  status!: 'missing' | 'resolved';
}

@modelOptions({
  schemaOptions: {
    collection: 'import_sessions',
    timestamps: false,
  },
})
export class ImportSession {
  @prop({ required: true })
  _id!: string;

  @prop({ required: true })
  title!: string;

  @prop({ required: true, type: () => [ImportAssetRef], default: [] })
  assets!: ImportAssetRef[];

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  /** MongoDB TTL index 基于此字段自动删除过期会话 */
  @prop({ required: true, type: () => Date, expires: 1800 })
  expiresAt!: Date;
}
