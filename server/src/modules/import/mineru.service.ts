/**
 * MineruService — MinerU 精准解析 API v4 封装
 *
 * 负责将 docx/pdf 等文件通过 MinerU 云端转换为 markdown + 图片。
 * 流程：获取签名URL → 上传文件 → 提交解析任务 → 轮询结果 → 下载 zip → 解压提取。
 *
 * 错误透传：MinerU 返回的错误信息会包装成 NestJS 异常抛出，前端可直接展示。
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

/** MinerU 转换结果 */
export interface MineruResult {
  markdown: string;
  /** 提取的图片：filename → buffer */
  images: Map<string, Buffer>;
}

/** MinerU 错误码 → 用户友好提示 */
const ERROR_MESSAGES: Record<string, string> = {
  A0202: 'MinerU 认证失败：Token 无效',
  A0211: 'MinerU 认证失败：Token 已过期',
  '-60005': '文件超过 200MB 大小限制',
  '-60006': '文件超过 200 页限制',
  '-60012': 'MinerU 任务不存在',
};

@Injectable()
export class MineruService {
  private readonly logger = new Logger(MineruService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly modelVersion: string;
  private readonly language: string;
  private readonly enableFormula: boolean;
  private readonly enableTable: boolean;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('mineru.baseUrl', 'https://mineru.net');
    this.token = config.get<string>('mineru.token', '');
    this.modelVersion = config.get<string>('mineru.modelVersion', 'pipeline');
    this.language = config.get<string>('mineru.language', 'ch');
    this.enableFormula = config.get<boolean>('mineru.enableFormula', true);
    this.enableTable = config.get<boolean>('mineru.enableTable', true);
    this.pollIntervalMs = config.get<number>('mineru.pollIntervalMs', 3000);
    this.pollTimeoutMs = config.get<number>('mineru.pollTimeoutMs', 600000);
  }

  /** 检查 MinerU 是否已配置 */
  isConfigured(): boolean {
    return !!this.token;
  }

  /**
   * 将文件转换为 markdown（含图片提取）。
   * 同步等待 MinerU 处理完成，适合在 HTTP 请求中调用（前端显示 loading）。
   */
  async convert(fileName: string, buffer: Buffer): Promise<MineruResult> {
    if (!this.token) {
      throw new ServiceUnavailableException('MinerU 未配置 Token，无法转换文档');
    }

    // Step 1: 获取签名 URL
    const { batchId, presignedUrl } = await this.getPresignedUrl(fileName);

    // Step 2: 上传文件
    await this.uploadFile(presignedUrl, buffer);

    // Step 3: 提交解析任务
    await this.submitBatchTask(presignedUrl);

    // Step 4: 轮询等待结果
    const zipUrl = await this.pollUntilDone(batchId);

    // Step 5: 下载 zip 并解压提取
    return this.downloadAndExtract(zipUrl);
  }

  /** 获取 OSS 签名 URL */
  private async getPresignedUrl(fileName: string): Promise<{ batchId: string; presignedUrl: string }> {
    const res = await this.apiRequest('/api/v4/file-urls/batch', {
      method: 'POST',
      body: JSON.stringify({ files: [{ name: fileName, is_ocr: false }] }),
    });
    const data = res.data;
    return { batchId: data.batch_id, presignedUrl: data.file_urls[0] };
  }

  /** PUT 上传文件到签名 URL */
  private async uploadFile(presignedUrl: string, buffer: Buffer): Promise<void> {
    const res = await fetch(presignedUrl, { method: 'PUT', body: buffer });
    if (!res.ok) {
      throw new BadRequestException(`文件上传到 MinerU 失败 (HTTP ${res.status})`);
    }
    this.logger.log(`File uploaded to MinerU (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  /** 提交批量解析任务 */
  private async submitBatchTask(presignedUrl: string): Promise<void> {
    const cleanUrl = presignedUrl.split('?')[0];
    await this.apiRequest('/api/v4/extract/task/batch', {
      method: 'POST',
      body: JSON.stringify({
        files: [{ url: cleanUrl, is_ocr: false }],
        model_version: this.modelVersion,
        enable_formula: this.enableFormula,
        enable_table: this.enableTable,
        language: this.language,
      }),
    });
  }

  /** 轮询直到解析完成，返回 zip 下载 URL */
  private async pollUntilDone(batchId: string): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.pollTimeoutMs) {
      await this.sleep(this.pollIntervalMs);

      const res = await this.apiRequest(`/api/v4/extract-results/batch/${batchId}`, {
        method: 'GET',
      });

      const extract = res.data?.extract_result?.[0];
      if (!extract) continue;

      if (extract.state === 'done' && extract.full_zip_url) {
        const progress = extract.extract_progress;
        this.logger.log(`MinerU done: ${progress?.total_pages ?? '?'} pages`);
        return extract.full_zip_url;
      }

      if (extract.state === 'failed') {
        const errMsg = extract.err_msg || '未知错误';
        throw new BadRequestException(`MinerU 解析失败：${errMsg}`);
      }

      // running / pending / converting → 继续轮询
    }

    throw new GatewayTimeoutException('MinerU 解析超时，请稍后重试');
  }

  /** 下载 zip 并解压，提取 markdown + 图片 */
  private async downloadAndExtract(zipUrl: string): Promise<MineruResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mineru-'));

    try {
      // 下载 zip
      const zipRes = await fetch(zipUrl);
      if (!zipRes.ok) {
        throw new BadRequestException('MinerU 结果下载失败');
      }
      const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
      const zipPath = join(tmpDir, 'result.zip');
      const { writeFile: wf } = await import('fs/promises');
      await wf(zipPath, zipBuffer);

      // 解压
      const extractDir = join(tmpDir, 'extracted');
      execSync(`mkdir -p "${extractDir}" && unzip -o "${zipPath}" -d "${extractDir}"`, {
        stdio: 'pipe',
      });

      // 查找 markdown 文件
      const mdPath = execSync(`find "${extractDir}" -name "*.md" | head -1`, {
        encoding: 'utf-8',
      }).trim();

      if (!mdPath) {
        throw new BadRequestException('MinerU 返回结果中未找到 markdown 文件');
      }

      const markdown = await readFile(mdPath, 'utf-8');

      // 收集图片
      const images = new Map<string, Buffer>();
      const imagesDir = join(extractDir, 'images');
      try {
        // 查找所有图片目录（可能嵌套在子目录中）
        const imgDirPath = execSync(
          `find "${extractDir}" -type d -name "images" | head -1`,
          { encoding: 'utf-8' },
        ).trim();

        if (imgDirPath) {
          const imgFiles = await readdir(imgDirPath);
          for (const imgFile of imgFiles) {
            const imgBuffer = await readFile(join(imgDirPath, imgFile));
            images.set(imgFile, imgBuffer);
          }
        }
      } catch {
        // 没有图片目录，正常情况
      }

      this.logger.log(`Extracted: ${markdown.length} chars markdown, ${images.size} images`);
      return { markdown, images };
    } finally {
      // 清理临时目录
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** 统一的 MinerU API 请求封装，处理认证和错误码 */
  private async apiRequest(
    path: string,
    init: RequestInit,
  ): Promise<{ code: number; data: Record<string, any> }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(init.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    };

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      throw new ServiceUnavailableException(`MinerU API 请求失败 (HTTP ${res.status})`);
    }

    const json = await res.json();

    if (json.code !== 0) {
      const friendlyMsg = ERROR_MESSAGES[String(json.code)] || json.msg || `MinerU 错误 (${json.code})`;
      this.logger.warn(`MinerU API error: code=${json.code}, msg=${json.msg}`);
      throw new BadRequestException(friendlyMsg);
    }

    return json;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
