/**
 * BatchImportSession — 批量导入的会话信封。
 *
 * 聚合多个 ImportSession（每个对应一个 .md 文件），
 * 记录目标父节点和目录结构关系，TTL 30 分钟自动过期。
 */
import { modelOptions, prop } from '@typegoose/typegoose';

export class BatchImportItem {
  @prop({ required: true }) parseId!: string;
  @prop({ required: true }) relativePath!: string;
  @prop({ required: true }) title!: string;
}

@modelOptions({
  schemaOptions: { collection: 'import_batch_sessions', timestamps: false },
})
export class BatchImportSession {
  @prop({ required: true }) _id!: string; // batchId (nanoid)
  @prop({ required: true }) parentId!: string;
  @prop({ required: true, type: () => [BatchImportItem], default: [] })
  items!: BatchImportItem[];
  @prop({ required: true, type: () => Date }) createdAt!: Date;
  @prop({ required: true, type: () => Date, expires: 1800 }) expiresAt!: Date;
}
