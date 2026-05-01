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

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Minio.Client({
      endPoint: config.getOrThrow<string>('minio.endpoint'),
      port: config.getOrThrow<number>('minio.port'),
      useSSL: config.get<boolean>('minio.useSSL', false),
      accessKey: config.getOrThrow<string>('minio.accessKey'),
      secretKey: config.getOrThrow<string>('minio.secretKey'),
    });
    this.bucket = config.getOrThrow<string>('minio.bucket');
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created bucket: ${this.bucket}`);
      }
      this.logger.log(`MinIO connected — bucket: ${this.bucket}`);
    } catch (err) {
      // MinIO 不可用时降级：不阻塞应用启动，草稿资源功能暂不可用
      this.logger.warn(
        `MinIO unavailable — draft asset features disabled. Error: ${err}`,
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
      contentType: (stat.metaData?.['content-type'] as string) || 'application/octet-stream',
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
    this.logger.log(`Cleaned ${objects.length} draft assets for ${contentItemId}`);
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
}
