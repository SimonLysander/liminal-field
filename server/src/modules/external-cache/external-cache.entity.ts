import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';

export type ExternalCacheStatus = 'ok' | 'error';

@index({ namespace: 1, operation: 1, keyHash: 1 }, { unique: true })
@index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
@index({ namespace: 1, status: 1, updatedAt: -1 })
@modelOptions({
  schemaOptions: { collection: 'external_cache_entries', timestamps: false },
  // key/payload/meta/error 按 namespace/operation 扩展,由各 consumer 在 service 层定义结构。
  options: { allowMixed: Severity.ALLOW },
})
export class ExternalCacheEntry {
  @prop({ required: true, type: () => String })
  _id!: string;

  @prop({ required: true, type: () => String })
  namespace!: string;

  @prop({ required: true, type: () => String })
  operation!: string;

  @prop({ required: true, type: () => Object })
  key!: Record<string, unknown>;

  @prop({ required: true, type: () => String })
  keyHash!: string;

  @prop({ required: true, type: () => String, enum: ['ok', 'error'] })
  status!: ExternalCacheStatus;

  @prop({ type: () => Object, default: null })
  payload!: unknown;

  @prop({ type: () => Object, default: null })
  error!: Record<string, unknown> | null;

  @prop({ type: () => Object, default: {} })
  meta!: Record<string, unknown>;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;

  @prop({ required: true, type: () => Date })
  expiresAt!: Date;
}
