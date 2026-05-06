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
import { execFile as execFileCb } from 'child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

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
      throw new ServiceUnavailableException(
        'MinerU 未配置 Token，无法转换文档',
      );
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
  private async getPresignedUrl(
    fileName: string,
  ): Promise<{ batchId: string; presignedUrl: string }> {
    const res = await this.apiRequest('/api/v4/file-urls/batch', {
      method: 'POST',
      body: JSON.stringify({ files: [{ name: fileName, is_ocr: false }] }),
    });
    const data = res.data as {
      batch_id: string;
      file_urls: string[];
    };
    return { batchId: data.batch_id, presignedUrl: data.file_urls[0] };
  }

  /** PUT 上传文件到签名 URL */
  private async uploadFile(
    presignedUrl: string,
    buffer: Buffer,
  ): Promise<void> {
    const res = await fetch(presignedUrl, { method: 'PUT', body: buffer });
    if (!res.ok) {
      throw new BadRequestException(
        `文件上传到 MinerU 失败 (HTTP ${res.status})`,
      );
    }
    this.logger.log(
      `File uploaded to MinerU (${(buffer.length / 1024).toFixed(0)} KB)`,
    );
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

      const res = await this.apiRequest(
        `/api/v4/extract-results/batch/${batchId}`,
        {
          method: 'GET',
        },
      );

      const data = res.data as {
        extract_result?: Array<{
          state?: string;
          full_zip_url?: string;
          extract_progress?: { total_pages?: number };
          err_msg?: string;
        }>;
      };
      const extract = data.extract_result?.[0];
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

      // 解压：用 execFile 而非 execSync，避免 shell 注入且不阻塞事件循环
      const extractDir = join(tmpDir, 'extracted');
      await mkdir(extractDir, { recursive: true });
      await execFile('unzip', ['-o', zipPath, '-d', extractDir]);

      // 递归查找 markdown 文件（替代 shell find 命令）
      const mdPath = await this.findFileRecursive(extractDir, (name) =>
        name.endsWith('.md'),
      );
      if (!mdPath) {
        throw new BadRequestException('MinerU 返回结果中未找到 markdown 文件');
      }

      const markdown = await readFile(mdPath, 'utf-8');

      // 递归查找 images 目录并收集图片
      const images = new Map<string, Buffer>();
      const imgDirPath = await this.findDirRecursive(extractDir, 'images');
      if (imgDirPath) {
        const imgFiles = await readdir(imgDirPath);
        for (const imgFile of imgFiles) {
          const imgBuffer = await readFile(join(imgDirPath, imgFile));
          images.set(imgFile, imgBuffer);
        }
      }

      this.logger.log(
        `Extracted: ${markdown.length} chars markdown, ${images.size} images`,
      );
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
  ): Promise<{ code: number; data: unknown }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(init.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    };

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      throw new ServiceUnavailableException(
        `MinerU API 请求失败 (HTTP ${res.status})`,
      );
    }

    const json = (await res.json()) as {
      code?: number;
      msg?: string;
      data?: unknown;
    };

    const code = json.code ?? -1;
    if (code !== 0) {
      const friendlyMsg =
        ERROR_MESSAGES[String(code)] || json.msg || `MinerU 错误 (${code})`;
      this.logger.warn(`MinerU API error: code=${code}, msg=${json.msg}`);
      throw new BadRequestException(friendlyMsg);
    }

    return { code, data: json.data };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 递归查找第一个匹配条件的文件，替代 shell `find -name` */
  private async findFileRecursive(
    dir: string,
    predicate: (name: string) => boolean,
  ): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && predicate(entry.name)) return fullPath;
      if (entry.isDirectory()) {
        const found = await this.findFileRecursive(fullPath, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  /** 递归查找第一个匹配名称的目录，替代 shell `find -type d -name` */
  private async findDirRecursive(
    dir: string,
    targetName: string,
  ): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.name === targetName) return fullPath;
      const found = await this.findDirRecursive(fullPath, targetName);
      if (found) return found;
    }
    return null;
  }
}
