/**
 * MinioService — MinIO 对象存储封装。
 *
 * 负责草稿资源的临时存储：编辑器上传的图片暂存在 MinIO draft-assets 桶中，
 * commit 时下载到 git 工作区，discard 时清理。
 * 对象 key 格式：{contentItemId}/{sanitized-fileName}
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/** MinIO / Node 连接错误常为 AggregateError，外层 message 为空，需展开 errors[] */
function formatConnectionFailure(err: unknown): string {
  if (err instanceof AggregateError && err.errors?.length) {
    return err.errors.map((e) => formatConnectionFailure(e)).join('; ');
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === 'string' && o.message.trim()) {
      parts.push(o.message.trim());
    }
    if (typeof o.code === 'string') parts.push(`code=${o.code}`);
    if (typeof o.errno === 'number' || typeof o.errno === 'string') {
      parts.push(`errno=${o.errno}`);
    }
    if (typeof o.syscall === 'string') parts.push(`syscall=${o.syscall}`);
    if (typeof o.address === 'string') parts.push(`address=${o.address}`);
    if (typeof o.port === 'number') parts.push(`port=${o.port}`);
    if (parts.length) return parts.join(', ');
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly minioEndPoint: string;
  private readonly minioPort: number;
  private readonly minioUseSSL: boolean;
  private client: Minio.Client;
  private bucket: string;
  /** bucketExists / makeBucket 成功后才为 true；供启动诊断与排障 */
  private draftStorageReady = false;
  /** 未就绪时由 onModuleInit 记录，供 StartupDiagnostics 输出与首包 WARN 一致 */
  private draftStorageInitError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.minioEndPoint = config.getOrThrow<string>('minio.endpoint');
    this.minioPort = config.getOrThrow<number>('minio.port');
    this.minioUseSSL = config.get<boolean>('minio.useSSL', false);
    this.client = new Minio.Client({
      endPoint: this.minioEndPoint,
      port: this.minioPort,
      useSSL: this.minioUseSSL,
      accessKey: config.getOrThrow<string>('minio.accessKey'),
      secretKey: config.getOrThrow<string>('minio.secretKey'),
    });
    this.bucket = config.getOrThrow<string>('minio.bucket');
  }

  /** 草稿桶已连通时为 true；未连通时上传仍会抛错（不在每次请求里重复探测） */
  isDraftStorageReady(): boolean {
    return this.draftStorageReady;
  }

  /** 与 isDraftStorageReady 配套；未就绪时返回与启动阶段相同的原因说明 */
  getDraftStorageInitError(): string | null {
    return this.draftStorageInitError;
  }

  /** Snapshot of yaml MinIO settings for startup diagnostics */
  getDraftStorageConfig(): {
    endpoint: string;
    port: number;
    bucket: string;
    useSSL: boolean;
  } {
    return {
      endpoint: this.minioEndPoint,
      port: this.minioPort,
      bucket: this.bucket,
      useSSL: this.minioUseSSL,
    };
  }

  async onModuleInit() {
    const target = `${this.minioEndPoint}:${this.minioPort}`;
    this.draftStorageInitError = null;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`MinIO: created bucket "${this.bucket}"`);
      }
      this.draftStorageReady = true;
    } catch (err: unknown) {
      this.draftStorageReady = false;
      const cause = formatConnectionFailure(err);
      this.draftStorageInitError = cause;
      this.logger.warn(
        `MinIO: unreachable at ${target} — draft uploads will fail. Cause: ${cause}`,
      );
    }
  }

  /** 上传草稿资源到 MinIO */
  async uploadDraftAsset(
    contentItemId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const objectKey = `${contentItemId}/${fileName}`;
    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    return fileName;
  }

  /** 获取草稿资源 */
  async getDraftAsset(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const objectKey = `${contentItemId}/${fileName}`;
    const stream = await this.client.getObject(this.bucket, objectKey);
    const stat = await this.client.statObject(this.bucket, objectKey);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType:
        (stat.metaData?.['content-type'] as string) ||
        'application/octet-stream',
    };
  }

  /** 删除某个 contentItemId 下的全部草稿资源 */
  async deleteDraftAssets(contentItemId: string): Promise<void> {
    const prefix = `${contentItemId}/`;
    const objects: string[] = [];

    const stream = this.client.listObjects(this.bucket, prefix, true);
    for await (const obj of stream) {
      if (obj.name) objects.push(obj.name);
    }

    if (objects.length === 0) return;

    await this.client.removeObjects(this.bucket, objects);
    this.logger.log(
      `Cleaned ${objects.length} draft assets for ${contentItemId}`,
    );
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
    const materialized: string[] = [];

    const stream = this.client.listObjects(this.bucket, prefix, true);
    for await (const obj of stream) {
      if (!obj.name) continue;
      const fileName = obj.name.slice(prefix.length);

      try {
        const dataStream = await this.client.getObject(this.bucket, obj.name);
        const chunks: Buffer[] = [];
        for await (const chunk of dataStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        await writeFile(join(targetDir, fileName), Buffer.concat(chunks));
        materialized.push(fileName);
      } catch (err) {
        this.logger.warn(`Failed to materialize ${obj.name}: ${err}`);
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
    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  /** 通用对象读取：按 objectKey 下载并返回完整 Buffer */
  async getObject(objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** 列出指定前缀下的全部对象 key */
  async listByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const stream = this.client.listObjects(this.bucket, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  /** 删除指定前缀下的全部对象 */
  async removeByPrefix(prefix: string): Promise<void> {
    const keys = await this.listByPrefix(prefix);
    if (keys.length === 0) return;
    await this.client.removeObjects(this.bucket, keys);
    this.logger.log(`Removed ${keys.length} objects under prefix "${prefix}"`);
  }
}
