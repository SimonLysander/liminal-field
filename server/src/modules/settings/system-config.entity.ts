import { modelOptions, prop, Severity } from '@typegoose/typegoose';

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

  @prop({ type: () => Date })
  updatedAt?: Date;
}
