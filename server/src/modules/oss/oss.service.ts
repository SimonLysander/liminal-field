/**
 * OssService — 阿里云 OSS 对象存储封装，替代 MinioService。
 *
 * V2 架构中承担 L1 编辑层（草稿资源）和 L3 资源服务层（发布后图片）的存储职责。
 * ECS 生产环境走内网 endpoint（免流量费），本地开发走外网。
 *
 * 公开 API 与 MinioService 完全一致，调用方只需替换 import 路径。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { MinioDraftStorageStatus } from '../minio/minio-draft-storage-status';

@Injectable()
export class OssService implements OnModuleInit, MinioDraftStorageStatus {
  private readonly logger = new Logger(OssService.name);
  /**
   * OSS client 懒加载：配置变更时自动重建，调用方无感。
   * 通过 configHash 检测 process.env 是否变化，变了就 new 新实例。
   */
  private _client!: OSS;
  private _configHash = '';
  /** 生产环境（NODE_ENV=production）走内网 endpoint，本地开发走外网 */
  private readonly isProduction: boolean;

  /** bucketInfo 成功后才为 true；供启动诊断与排障 */
  private draftStorageReady = false;
  /** 未就绪时由 onModuleInit 记录，供 StartupDiagnostics 输出 */
  private draftStorageInitError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.isProduction = process.env.NODE_ENV === 'production';
    this._client = this.buildClient();
  }

  /** 当前配置指纹：env 变了 → hash 变了 → 下次访问自动重建 */
  private currentConfigHash(): string {
    return [
      process.env.OSS_REGION,
      process.env.OSS_ACCESS_KEY_ID,
      process.env.OSS_ACCESS_KEY_SECRET,
      process.env.OSS_BUCKET,
      process.env.OSS_INTERNAL,
    ].join(':');
  }

  private buildClient(): OSS {
    this._configHash = this.currentConfigHash();
    return new OSS({
      region: this.config.getOrThrow<string>('oss.region'),
      accessKeyId:
        process.env.OSS_ACCESS_KEY_ID ||
        this.config.getOrThrow<string>('oss.accessKeyId'),
      accessKeySecret:
        process.env.OSS_ACCESS_KEY_SECRET ||
        this.config.getOrThrow<string>('oss.accessKeySecret'),
      bucket:
        process.env.OSS_BUCKET || this.config.getOrThrow<string>('oss.bucket'),
      internal: process.env.OSS_INTERNAL === 'true',
    });
  }

  /** 获取 client：配置变了自动重建，调用方无感 */
  private get client(): OSS {
    if (this.currentConfigHash() !== this._configHash) {
      this._client = this.buildClient();
      this.logger.log('OSS client auto-rebuilt (config changed)');
    }
    return this._client;
  }

  private get bucketName(): string {
    return (
      process.env.OSS_BUCKET || this.config.getOrThrow<string>('oss.bucket')
    );
  }

  private get region(): string {
    return (
      process.env.OSS_REGION || this.config.getOrThrow<string>('oss.region')
    );
  }

  /** 草稿桶已连通时为 true；未连通时上传仍会抛错（不在每次请求里重复探测） */
  isDraftStorageReady(): boolean {
    return this.draftStorageReady;
  }

  /** 与 isDraftStorageReady 配套；未就绪时返回与启动阶段相同的原因说明 */
  getDraftStorageInitError(): string | null {
    return this.draftStorageInitError;
  }

  /**
   * 与 MinioService 保持相同签名，供 StartupDiagnosticsService 消费。
   * endpoint 字段根据环境拼接对应的 OSS 域名；port 固定 443（HTTPS）。
   */
  getDraftStorageConfig(): {
    endpoint: string;
    port: number;
    bucket: string;
    useSSL: boolean;
  } {
    const useInternal = process.env.OSS_INTERNAL === 'true';
    const endpoint = useInternal
      ? `${this.region}-internal.aliyuncs.com`
      : `${this.region}.aliyuncs.com`;
    return {
      endpoint,
      port: 443,
      bucket: this.bucketName,
      useSSL: true,
    };
  }

  /** 模块初始化：探测 bucket 是否存在以确认连通性 */
  async onModuleInit() {
    this.draftStorageInitError = null;
    const cfg = this.getDraftStorageConfig();
    const target = `${cfg.endpoint}/${this.bucketName}`;
    try {
      await this.client.getBucketInfo(this.bucketName);
      this.draftStorageReady = true;
    } catch (err: unknown) {
      this.draftStorageReady = false;
      const cause = err instanceof Error ? err.message : String(err);
      this.draftStorageInitError = cause;
      this.logger.warn(
        `OSS: unreachable at ${target} — draft uploads will fail. Cause: ${cause}`,
      );
    }
  }

  /** 上传草稿资源到 OSS；对象 key 格式：{contentItemId}/{fileName} */
  async uploadDraftAsset(
    contentItemId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const objectKey = `${contentItemId}/${fileName}`;
    await this.client.put(objectKey, buffer, { mime: mimeType });
    return fileName;
  }

  /** 获取草稿资源，返回 buffer + content-type */
  async getDraftAsset(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const objectKey = `${contentItemId}/${fileName}`;
    // ali-oss client.get 返回 { content: Buffer, res: { headers } }
    const result = await this.client.get(objectKey);
    const contentType =
      (result.res.headers as Record<string, string>)['content-type'] ||
      'application/octet-stream';
    return {
      buffer: Buffer.isBuffer(result.content)
        ? result.content
        : Buffer.from(result.content as Uint8Array),
      contentType,
    };
  }

  /** 删除某个 contentItemId 下的全部草稿资源 */
  async deleteDraftAssets(contentItemId: string): Promise<void> {
    const prefix = `${contentItemId}/`;
    const keys = await this.listByPrefix(prefix);
    if (keys.length === 0) return;
    // ali-oss deleteMulti 接受对象数组，每个元素为 { name: string }
    await this.client.deleteMulti(keys);
    this.logger.log(`Cleaned ${keys.length} draft assets for ${contentItemId}`);
  }

  /**
   * commit 时：下载该 contentItemId 的全部草稿资源到目标磁盘目录。
   * 返回成功落盘的文件名列表。
   */
  async moveDraftAssetsToDisk(
    contentItemId: string,
    targetDir: string,
  ): Promise<string[]> {
    await mkdir(targetDir, { recursive: true });

    const prefix = `${contentItemId}/`;
    const keys = await this.listByPrefix(prefix);
    const materialized: string[] = [];

    for (const key of keys) {
      const fileName = key.slice(prefix.length);
      try {
        const result = await this.client.get(key);
        const buf = Buffer.isBuffer(result.content)
          ? result.content
          : Buffer.from(result.content as Uint8Array);
        await writeFile(join(targetDir, fileName), buf);
        materialized.push(fileName);
      } catch (err) {
        this.logger.warn(`Failed to materialize ${key}: ${err}`);
      }
    }

    if (materialized.length > 0) {
      this.logger.log(
        `Materialized ${materialized.length} assets for ${contentItemId}`,
      );
    }

    return materialized;
  }

  /** 通用对象写入：将 buffer 以指定 MIME 类型存入任意 objectKey */
  async putObject(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.put(objectKey, buffer, { mime: mimeType });
  }

  /** 通用对象读取：按 objectKey 下载并返回完整 Buffer */
  async getObject(objectKey: string): Promise<Buffer> {
    const result = await this.client.get(objectKey);
    return Buffer.isBuffer(result.content)
      ? result.content
      : Buffer.from(result.content as Uint8Array);
  }

  /**
   * 按 objectKey 下载并在 OSS 端应用图片处理(如 IMAGE_PRESETS.vision 缩放+webp),返回处理后 Buffer。
   * 给 agent 视觉注入用:缩放在 OSS 端做,后端只搬小图,不读磁盘、不取原图。
   */
  async getObjectProcessed(
    objectKey: string,
    process: string,
  ): Promise<Buffer> {
    const result = await this.client.get(objectKey, { process });
    return Buffer.isBuffer(result.content)
      ? result.content
      : Buffer.from(result.content as Uint8Array);
  }

  /** 列出指定前缀下的全部对象 key（最多 1000 条，生产数据量足够） */
  async listByPrefix(prefix: string): Promise<string[]> {
    const result = await this.client.list({ prefix, 'max-keys': 1000 }, {});
    const objects = result.objects ?? [];
    return objects.map((o) => o.name);
  }

  // ─── L3 资源服务层：公开 URL + 内部拷贝 ───

  /** 图片处理预设：不同展示场景使用不同缩放 + WebP 转换参数 */
  static readonly IMAGE_PRESETS = {
    /** 列表缩略图 38×38 等 */
    thumbnail: 'image/resize,w_200/format,webp',
    /** 封面卡片 ~400px */
    cover: 'image/resize,w_400/format,webp',
    /** 详情轮播 ~1200px */
    detail: 'image/resize,w_1200/format,webp',
    /**
     * agent 视觉注入守卫:**最长边**封顶 896 + limit_1(只降不升)+ webp。
     * - limit_1:原图小于阈值则原样返回——「发现超大才降到阈值下」,本就小的不动;
     * - l_(最长边)而非 w_(宽):竖图也守得住,封住总分辨率 → 封住视觉 token(按切片算,与文件大小无关);
     * - 视觉 token 大致随分辨率^2,896 比 1280 砍掉约一半,写图说够清晰、又快又省。
     */
    vision: 'image/resize,l_896,limit_1/format,webp',
    /** 笔记阅读宽度 ~800px */
    reading: 'image/resize,w_800/format,webp',
    /** Lightbox 全屏 ~2000px */
    full: 'image/resize,w_2000/format,webp',
  } as const;

  /**
   * 生成 OSS 公开访问 URL（走外网域名，客户端直连）。
   * @param key OSS 对象 key
   * @param process 可选的图片处理参数（如 IMAGE_PRESETS.cover）
   * @param expires 签名有效期秒数，默认 1 小时
   */
  getPublicUrl(key: string, process?: string, expires = 3600): string {
    const url = this.client.signatureUrl(key, {
      expires,
      process: process || undefined,
      // secure 已从 ali-oss SignatureUrlOptions 类型中移除；外网域名通过下方 replace 得到
    });
    // internal endpoint（-internal.aliyuncs.com）浏览器不可达，替换为外网域名
    return url.replace('-internal.aliyuncs.com', '.aliyuncs.com');
  }

  /**
   * OSS 内部对象拷贝（同 bucket，零流量消耗）。
   * 用于 commit 时把草稿资源拷贝到永久位置。
   */
  async copyObject(srcKey: string, destKey: string): Promise<void> {
    await this.client.copy(destKey, srcKey);
  }

  /**
   * commit 时把草稿资源提升为永久资源：
   * 从 draft key（{contentId}/{fileName}）拷贝到永久 key（assets/{contentId}/{fileName}）。
   * 返回提升成功的文件名列表。
   */
  async promoteDraftAssets(contentItemId: string): Promise<string[]> {
    const prefix = `${contentItemId}/`;
    const keys = await this.listByPrefix(prefix);
    const promoted: string[] = [];

    for (const key of keys) {
      const fileName = key.slice(prefix.length);
      const permanentKey = `assets/${contentItemId}/${fileName}`;
      try {
        await this.copyObject(key, permanentKey);
        promoted.push(fileName);
      } catch (err) {
        this.logger.warn(`Failed to promote ${key} → ${permanentKey}: ${err}`);
      }
    }

    if (promoted.length > 0) {
      this.logger.log(
        `Promoted ${promoted.length} assets for ${contentItemId} to permanent OSS`,
      );
    }

    return promoted;
  }

  /** 删除指定前缀下的全部对象 */
  async removeByPrefix(prefix: string): Promise<void> {
    const keys = await this.listByPrefix(prefix);
    if (keys.length === 0) return;
    await this.client.deleteMulti(keys);
    this.logger.log(`Removed ${keys.length} objects under prefix "${prefix}"`);
  }
}
