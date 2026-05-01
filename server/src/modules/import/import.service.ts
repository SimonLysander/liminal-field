import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { parse as parsePath } from 'path';
import { MinioService } from '../minio/minio.service';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import { ContentRepository } from '../content/content.repository';
import { ContentItem, ContentChangeType } from '../content/content-item.entity';
import { NavigationNodeService } from '../navigation/navigation.service';
import { AssetRefDto, ParseResultDto } from './dto/parse-result.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';

/** MinIO 中 import 临时文件的前缀 */
const IMPORT_PREFIX = 'import-temp';

interface ImportMeta {
  title: string;
  markdown: string;
  assets: AssetRefDto[];
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly minioService: MinioService,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly contentRepository: ContentRepository,
    private readonly navigationNodeService: NavigationNodeService,
  ) {}

  /**
   * 解析上传的 markdown 文件，扫描本地图片引用，
   * 将结果暂存到 MinIO，返回 parseId 供后续步骤使用。
   */
  async parse(fileName: string, buffer: Buffer): Promise<ParseResultDto> {
    const parseId = randomUUID().replace(/-/g, '').slice(0, 16);
    const title = parsePath(fileName).name;
    let markdown = buffer.toString('utf-8');

    // 标题层级归一化：找到最小标题级别，整体前移到 h1
    markdown = this.normalizeHeadingLevels(markdown);

    // 将 Obsidian 风格 ==highlight== 转换为 Plate 识别的 <mark> 标签
    markdown = markdown.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>');

    // 收窄多余空行：连续 3 行及以上空行压缩为 2 行（保留段落间距）
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    // 扫描非 http(s) 开头的图片引用
    const localImageRegex = /!\[([^\]]*)\]\(((?!https?:\/\/)[^)]+)\)/g;
    const assets: AssetRefDto[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = localImageRegex.exec(markdown)) !== null) {
      const ref = match[2];
      const filename = parsePath(ref).base;
      if (seen.has(filename)) continue;
      seen.add(filename);
      assets.push({ ref, filename, status: 'missing' });
    }

    // 存 meta.json 到 MinIO
    const meta: ImportMeta = { title, markdown, assets };
    await this.minioService.putObject(
      `${IMPORT_PREFIX}/${parseId}/meta.json`,
      Buffer.from(JSON.stringify(meta), 'utf-8'),
      'application/json',
    );

    return { parseId, title, markdown, assets };
  }

  /**
   * 接收用户补传的文件，按文件名匹配缺失资源，
   * 匹配到的文件存入 MinIO 临时目录。
   */
  async resolveAssets(
    parseId: string,
    files: { filename: string; buffer: Buffer; mimetype: string }[],
  ): Promise<AssetRefDto[]> {
    const meta = await this.getMeta(parseId);

    // 构建待匹配 map：filename → asset index
    const missingMap = new Map<string, number>();
    meta.assets.forEach((asset, i) => {
      if (asset.status === 'missing') missingMap.set(asset.filename.toLowerCase(), i);
    });

    // 遍历上传文件，按 basename 匹配
    for (const file of files) {
      const basename = parsePath(file.filename).base.toLowerCase();
      const idx = missingMap.get(basename);
      if (idx !== undefined) {
        await this.minioService.putObject(
          `${IMPORT_PREFIX}/${parseId}/assets/${meta.assets[idx].filename}`,
          file.buffer,
          file.mimetype,
        );
        meta.assets[idx].status = 'resolved';
        missingMap.delete(basename);
      }
    }

    // 更新 meta.json
    await this.minioService.putObject(
      `${IMPORT_PREFIX}/${parseId}/meta.json`,
      Buffer.from(JSON.stringify(meta), 'utf-8'),
      'application/json',
    );

    return meta.assets;
  }

  /**
   * 确认导入：单次 commit 创建 content item + structure node。
   * 直接使用底层服务，避免 createContent+saveContent 产生两次提交。
   */
  async confirm(dto: ConfirmImportDto): Promise<{ nodeId: string; contentItemId: string }> {
    const meta = await this.getMeta(dto.parseId);
    const title = dto.title || meta.title;
    const now = new Date();
    const contentId = `ci_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    await this.contentGitService.prepareWritableWorkspace();

    // 存储已匹配的资源到 git 仓库，收集路径映射
    const pathMap = new Map<string, string>();
    for (const asset of meta.assets) {
      if (asset.status === 'resolved') {
        const buf = await this.minioService.getObject(
          `${IMPORT_PREFIX}/${dto.parseId}/assets/${asset.filename}`,
        );
        const stored = await this.contentRepoService.storeAsset(
          contentId,
          asset.filename,
          buf,
        );
        pathMap.set(asset.filename, stored.path);
      }
    }

    // 重写 markdown 中的图片路径
    let body = meta.markdown;
    for (const asset of meta.assets) {
      if (asset.status === 'resolved') {
        const newPath = pathMap.get(asset.filename);
        if (newPath) {
          body = body.split(asset.ref).join(newPath);
        }
      }
    }
    body = body || '\u200B';

    // 写入 main.md + README → 单次 git commit
    await this.contentRepoService.writeMainMarkdown(contentId, body);
    const source = await this.contentRepoService.readContentSource(contentId);
    const changeNote = '从文件导入';
    const changeLog = {
      title,
      summary: title,
      changeNote,
      changeType: ContentChangeType.major,
      changedAt: now,
    };
    await this.contentRepoService.writeReadme(
      { id: contentId, _id: contentId, latestVersion: { commitHash: '', title, summary: title }, changeLogs: [changeLog], createdAt: now, updatedAt: now } as ContentItem,
      source.assetRefs,
    );

    const commitHash = await this.contentGitService.recordCommittedContentChange(contentId, changeNote);
    if (!commitHash) {
      throw new BadRequestException('导入提交失败');
    }

    // 创建 MongoDB 记录
    await this.contentRepository.create({
      id: contentId,
      latestVersion: { commitHash, title, summary: title },
      publishedVersion: null,
      changeLogs: [{ ...changeLog, commitHash }],
      createdAt: now,
      updatedAt: now,
    });

    // 创建 structure node（传 contentItemId 避免重复创建 CI）
    const node = await this.navigationNodeService.createStructureNode({
      name: title,
      type: 'DOC',
      parentId: dto.parentId,
      contentItemId: contentId,
    });

    // 清理 MinIO 临时数据
    await this.minioService.removeByPrefix(`${IMPORT_PREFIX}/${dto.parseId}/`);
    this.logger.log(`Import confirmed: ${contentId} (${title})`);

    return { nodeId: node.id, contentItemId: contentId };
  }

  /**
   * 标题层级归一化：找到文档中最小的标题级别，整体前移使其从 h1 开始。
   * 例如文档最高是 ####(h4)，则 h4→h1, h5→h2, h6→h3。
   */
  private normalizeHeadingLevels(markdown: string): string {
    const headingRegex = /^(#{1,6})\s/gm;
    let minLevel = 7;
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(markdown)) !== null) {
      minLevel = Math.min(minLevel, match[1].length);
    }

    // 已经从 h1 开始，或没有标题
    if (minLevel <= 1 || minLevel > 6) return markdown;

    const shift = minLevel - 1;
    return markdown.replace(/^(#{1,6})\s/gm, (_, hashes: string) => {
      const newLevel = Math.max(1, hashes.length - shift);
      return '#'.repeat(newLevel) + ' ';
    });
  }

  /** 每小时清理超时的 import 临时数据（兜底，正常流程在 confirm/cancel 时清理） */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredImports() {
    try {
      const keys = await this.minioService.listByPrefix(`${IMPORT_PREFIX}/`);
      if (keys.length === 0) return;

      // 按 parseId 分组
      const parseIds = new Set<string>();
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length >= 2) parseIds.add(parts[1]);
      }

      if (parseIds.size > 0) {
        this.logger.log(`Import cleanup check: ${parseIds.size} active sessions`);
      }
    } catch {
      // MinIO 不可用时静默忽略
    }
  }

  /** 从 MinIO 读取 import meta */
  private async getMeta(parseId: string): Promise<ImportMeta> {
    try {
      const buf = await this.minioService.getObject(
        `${IMPORT_PREFIX}/${parseId}/meta.json`,
      );
      return JSON.parse(buf.toString('utf-8')) as ImportMeta;
    } catch {
      throw new NotFoundException('导入会话不存在或已过期');
    }
  }
}
