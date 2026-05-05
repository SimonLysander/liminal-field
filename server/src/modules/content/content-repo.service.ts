import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { basename, extname, join, parse, resolve } from 'path';
import { randomUUID } from 'crypto';
import simpleGit, { SimpleGit } from 'simple-git';
import { ContentItem } from './content-item.entity';
import { ContentAssetType } from './dto/content-detail.dto';
import { resolveAndEnsureContentRepoRoot } from './resolve-content-repo-root';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

export interface ParsedAssetRef {
  path: string;
  type: ContentAssetType;
}

export interface ParsedContentSource {
  bodyMarkdown: string;
  plainText: string;
  assetRefs: ParsedAssetRef[];
}

export interface StoredAsset {
  path: string;
  fileName: string;
}

export interface ListedAsset extends StoredAsset {
  type: ContentAssetType;
  size: number;
}

@Injectable()
export class ContentRepoService {
  private readonly logger = new Logger(ContentRepoService.name);
  readonly repoRoot: string;
  private readonly contentRoot: string;
  private readonly git: SimpleGit;

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.getOrThrow<string>('content.repoRoot');
    const { absoluteRoot, created } =
      resolveAndEnsureContentRepoRoot(configured);
    this.repoRoot = absoluteRoot;
    if (created) {
      this.logger.log(
        `Content repo root did not exist; created directory: ${this.repoRoot}`,
      );
    }
    this.contentRoot = join(this.repoRoot, 'content');
    this.git = simpleGit(this.repoRoot);
  }

  private getContentDirectory(contentId: string): string {
    return join(this.contentRoot, contentId);
  }

  getContentRootPath(): string {
    return this.contentRoot;
  }

  getContentDirectoryPath(contentId: string): string {
    return this.getContentDirectory(contentId);
  }

  private getMainMarkdownPath(contentId: string): string {
    return join(this.getContentDirectory(contentId), 'main.md');
  }

  private getReadmePath(contentId: string): string {
    return join(this.getContentDirectory(contentId), 'README.md');
  }

  private getAssetsDirectory(contentId: string): string {
    return join(this.getContentDirectory(contentId), 'assets');
  }

  /**
   * 外部传入的文件名必须经过此方法清洗，防止路径穿越（如 ../../etc/passwd）。
   * 只保留 basename，再验证拼接后的绝对路径仍在 assets 目录内。
   */
  private resolveAssetPath(contentId: string, fileName: string): string {
    const safe = basename(fileName);
    if (!safe || safe === '.' || safe === '..') {
      throw new BadRequestException('Invalid asset file name');
    }
    const assetsDir = this.getAssetsDirectory(contentId);
    const resolved = resolve(assetsDir, safe);
    if (!resolved.startsWith(assetsDir)) {
      throw new BadRequestException('Invalid asset file name');
    }
    return resolved;
  }

  private resolveRepositoryRoot(): string {
    return this.repoRoot;
  }

  private sanitizeAssetFileName(originalFileName: string): string {
    const parsed = parse(originalFileName);
    // toLowerCase() 之后字符串不含大写字母，正则无需保留 A-Z
    const baseName = (parsed.name || 'asset')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const safeBaseName = baseName || 'asset';
    const extension = extname(parsed.base)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '')
      .slice(0, 20);

    // 上传文件名来自外部输入，落盘前统一清洗并加随机后缀，避免路径穿越和同名覆盖。
    return `${safeBaseName}-${randomUUID().slice(0, 8)}${extension}`;
  }

  private toAssetType(assetPath: string): ContentAssetType {
    const normalized = assetPath.toLowerCase();
    const extension = normalized.slice(normalized.lastIndexOf('.'));

    if (IMAGE_EXTENSIONS.has(extension)) {
      return 'image';
    }
    if (AUDIO_EXTENSIONS.has(extension)) {
      return 'audio';
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      return 'video';
    }
    return 'file';
  }

  private extractLinkTargets(bodyMarkdown: string): string[] {
    const matches = bodyMarkdown.matchAll(
      /(?:!\[[^\]]*]\(([^)\s]+)\)|\[[^\]]*]\(([^)\s]+)\))/g,
    );

    const targets: string[] = [];
    for (const match of matches) {
      const target = match[1] ?? match[2];
      if (target) {
        targets.push(target);
      }
    }
    return targets;
  }

  private extractAssetRefs(bodyMarkdown: string): ParsedAssetRef[] {
    // 内容协议只把 ./assets/ 下的相对路径视为可托管资源，避免把任意外链误当成项目内附件。
    const assetPaths = new Set<string>();
    for (const target of this.extractLinkTargets(bodyMarkdown)) {
      if (target.startsWith('./assets/')) {
        assetPaths.add(target);
      }
    }

    return Array.from(assetPaths).map((path) => ({
      path,
      type: this.toAssetType(path),
    }));
  }

  private extractPlainText(bodyMarkdown: string): string {
    // plainText 不是做富文本还原，而是提供稳定的搜索/摘要输入，因此优先保留文本语义、丢弃样式标记。
    return bodyMarkdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*]\(([^)\s]+)\)/g, ' ')
      .replace(/\[([^\]]+)]\(([^)\s]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private validateMainMarkdown(bodyMarkdown: string): void {
    // V1 协议只做最小但刚性的保存校验：正文不能为空，附件引用必须遵守统一相对路径规则。
    const plainText = this.extractPlainText(bodyMarkdown);
    if (!plainText) {
      throw new BadRequestException(
        '`main.md` must contain at least one non-empty text paragraph',
      );
    }

    for (const target of this.extractLinkTargets(bodyMarkdown)) {
      if (target.includes('assets/') && !target.startsWith('./assets/')) {
        throw new BadRequestException(
          'Asset references in `main.md` must use ./assets/ relative paths',
        );
      }
      if (
        target.startsWith('./assets/') &&
        target.length <= './assets/'.length
      ) {
        throw new BadRequestException(
          'Asset references in `main.md` must include a file name',
        );
      }
    }
  }

  private getRecentUpdatesLines(content: ContentItem): string[] {
    const latestChangeLogs = content.changeLogs.slice(0, 3);
    if (latestChangeLogs.length === 0) {
      return ['- No updates yet'];
    }

    return latestChangeLogs.map(
      (changeLog) =>
        `- ${changeLog.createdAt.toISOString().slice(0, 10)} | ${changeLog.changeType} | ${changeLog.changeNote}`,
    );
  }

  private getReadmeTitle(content: ContentItem): string {
    return content.latestVersion?.title ?? 'Untitled Content';
  }

  private getReadmeSummary(content: ContentItem): string {
    return content.latestVersion?.summary ?? '';
  }

  private getReadmeLines(
    content: ContentItem,
    assetRefs: ParsedAssetRef[],
  ): string[] {
    return [
      `# ${this.getReadmeTitle(content)}`,
      '',
      this.getReadmeSummary(content),
      '',
      '## Recent Updates',
      '',
      ...this.getRecentUpdatesLines(content),
      '',
      `Created: ${content.createdAt.toISOString().slice(0, 10)}`,
      `Media: ${this.getMediaSummary(assetRefs)}`,
      '',
    ];
  }

  private getMediaSummary(assetRefs: ParsedAssetRef[]): string {
    const counts = assetRefs.reduce<Record<ContentAssetType, number>>(
      (accumulator, assetRef) => {
        accumulator[assetRef.type] += 1;
        return accumulator;
      },
      {
        image: 0,
        audio: 0,
        video: 0,
        file: 0,
      },
    );

    const parts: string[] = [];
    if (counts.image) parts.push(`${counts.image} images`);
    if (counts.audio) parts.push(`${counts.audio} audio`);
    if (counts.video) parts.push(`${counts.video} videos`);
    if (counts.file) parts.push(`${counts.file} files`);

    return parts.length ? parts.join(', ') : 'No media';
  }

  async ensureContentScaffold(contentId: string): Promise<void> {
    await mkdir(this.getContentDirectory(contentId), { recursive: true });
    await mkdir(this.getAssetsDirectory(contentId), { recursive: true });
  }

  async storeAsset(
    contentId: string,
    originalFileName: string,
    buffer: Buffer,
  ): Promise<StoredAsset> {
    await this.ensureContentScaffold(contentId);

    const fileName = this.sanitizeAssetFileName(originalFileName);
    await writeFile(join(this.getAssetsDirectory(contentId), fileName), buffer);

    return {
      path: `./assets/${fileName}`,
      fileName,
    };
  }

  async listAssets(contentId: string): Promise<ListedAsset[]> {
    try {
      const assetFileNames = await readdir(this.getAssetsDirectory(contentId));

      // 资产列表直接以磁盘目录为准，这样上传完成后前端不必依赖正文是否已经引用该文件。
      const assets = await Promise.all(
        assetFileNames.map(async (fileName) => {
          const filePath = join(this.getAssetsDirectory(contentId), fileName);
          const fileStat = await stat(filePath);

          return {
            path: `./assets/${fileName}`,
            fileName,
            type: this.toAssetType(fileName),
            size: fileStat.size,
          };
        }),
      );

      return assets.sort((left, right) =>
        left.fileName.localeCompare(right.fileName),
      );
    } catch {
      return [];
    }
  }

  async writeMainMarkdown(
    contentId: string,
    bodyMarkdown: string,
  ): Promise<void> {
    // 先校验再落盘，避免把协议上不合法的正文写进 Git 真源后再靠别处兜底。
    this.validateMainMarkdown(bodyMarkdown);
    await this.ensureContentScaffold(contentId);
    await writeFile(this.getMainMarkdownPath(contentId), bodyMarkdown, 'utf8');
  }

  private async readVersionedMainMarkdown(
    contentId: string,
    commitHash: string,
  ): Promise<string> {
    const trackedFilePath = `content/${contentId}/main.md`;
    return this.git.show([`${commitHash}:${trackedFilePath}`]);
  }

  async readContentSource(
    contentId: string,
    options?: { commitHash?: string; scope?: string },
  ): Promise<ParsedContentSource> {
    let bodyMarkdown: string;
    try {
      bodyMarkdown = options?.commitHash
        ? await this.readVersionedMainMarkdown(contentId, options.commitHash)
        : await readFile(this.getMainMarkdownPath(contentId), 'utf8');
    } catch {
      /* main.md 不存在（刚创建还没第一次提交），返回空内容 */
      return { bodyMarkdown: '', plainText: '', assetRefs: [] };
    }
    /* 将 ./assets/ 相对路径改写为 API 绝对路径，scope 由调用方传入。
     * 有 commitHash 时附加 ?v=hash，确保历史版本的资源从正确的 git commit 读取。 */
    const scope = options?.scope ?? 'notes';
    const versionSuffix = options?.commitHash ? `?v=${options.commitHash}` : '';
    const resolvedMarkdown = bodyMarkdown.replaceAll(
      /\.\/assets\//g,
      `/api/v1/spaces/${scope}/items/${contentId}/assets/`,
    ).replaceAll(
      new RegExp(`/api/v1/spaces/${scope}/items/${contentId}/assets/([^)\\s"]+)`, 'g'),
      (match) => `${match}${versionSuffix}`,
    );
    return {
      bodyMarkdown: resolvedMarkdown,
      plainText: this.extractPlainText(bodyMarkdown),
      assetRefs: this.extractAssetRefs(bodyMarkdown),
    };
  }

  async writeReadme(
    content: ContentItem,
    assetRefs: ParsedAssetRef[],
  ): Promise<void> {
    // README 是仓库浏览摘要，不是第二份正文，因此这里只写协议规定的轻量展示信息。
    await writeFile(
      this.getReadmePath(content._id),
      this.getReadmeLines(content, assetRefs).join('\n'),
      'utf8',
    );
  }

  async deleteAsset(contentId: string, fileName: string): Promise<void> {
    const filePath = this.resolveAssetPath(contentId, fileName);
    try {
      await unlink(filePath);
    } catch {
      // File already gone
    }
  }

  /**
   * 读取资源文件。支持可选 commitHash 从 git 历史读取，保证历史版本的资源可访问。
   * 无 commitHash 时从当前工作目录读取（最新版本）。
   */
  async readAssetBuffer(
    contentId: string,
    fileName: string,
    commitHash?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    let buffer: Buffer;
    if (commitHash) {
      // simple-git 的 show() 返回 string，会损坏二进制文件。
      // 直接 spawn git 进程拿 Buffer 输出，确保图片等二进制资源完整。
      const trackedPath = `content/${contentId}/assets/${fileName}`;
      buffer = await new Promise<Buffer>((res, rej) => {
        execFile('git', ['show', `${commitHash}:${trackedPath}`], {
          cwd: this.repoRoot,
          encoding: 'buffer',
          maxBuffer: 50 * 1024 * 1024, // 50MB
        }, (err, stdout) => {
          if (err) return rej(err);
          res(stdout as unknown as Buffer);
        });
      });
    } else {
      const filePath = this.resolveAssetPath(contentId, fileName);
      buffer = await readFile(filePath);
    }
    const ext = extname(fileName).toLowerCase();
    let contentType = 'application/octet-stream';
    if (IMAGE_EXTENSIONS.has(ext)) {
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      contentType = mimeMap[ext] || contentType;
    }
    return { buffer, contentType };
  }
}
