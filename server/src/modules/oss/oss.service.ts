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
  private readonly client: OSS;
  private readonly bucketName: string;
  /** 生产环境（NODE_ENV=production）走内网 endpoint，本地开发走外网 */
  private readonly isProduction: boolean;
  private readonly region: string;

  /** bucketInfo 成功后才为 true；供启动诊断与排障 */
  private draftStorageReady = false;
  /** 未就绪时由 onModuleInit 记录，供 StartupDiagnostics 输出 */
  private draftStorageInitError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.region = config.getOrThrow<string>('oss.region');
    this.bucketName = config.getOrThrow<string>('oss.bucket');

    this.client = new OSS({
      region: this.region,
      accessKeyId: config.getOrThrow<string>('oss.accessKeyId'),
      accessKeySecret: config.getOrThrow<string>('oss.accessKeySecret'),
      bucket: this.bucketName,
      // 生产环境走内网 endpoint 免流量费；本地开发走外网
      internal: this.isProduction,
    });
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
    const endpoint = this.isProduction
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

  /** 列出指定前缀下的全部对象 key（最多 1000 条，生产数据量足够） */
  async listByPrefix(prefix: string): Promise<string[]> {
    const result = await this.client.list({ prefix, 'max-keys': 1000 }, {});
    const objects = result.objects ?? [];
    return objects.map((o) => o.name);
  }

  /** 删除指定前缀下的全部对象 */
  async removeByPrefix(prefix: string): Promise<void> {
    const keys = await this.listByPrefix(prefix);
    if (keys.length === 0) return;
    await this.client.deleteMulti(keys);
    this.logger.log(`Removed ${keys.length} objects under prefix "${prefix}"`);
  }
}
