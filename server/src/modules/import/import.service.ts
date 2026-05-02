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
import { MineruService } from './mineru.service';
import { ImportSessionRepository } from './import-session.repository';
import { AssetRefDto, ParseResultDto } from './dto/parse-result.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';

/** 需要通过 MinerU 转换的文件扩展名 */
const MINERU_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.pptx', '.ppt']);

/** MinIO 中 import 临时文件的前缀 */
const IMPORT_PREFIX = 'import-temp';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly minioService: MinioService,
    private readonly mineruService: MineruService,
    private readonly importSessionRepo: ImportSessionRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly contentRepository: ContentRepository,
    private readonly navigationNodeService: NavigationNodeService,
  ) {}

  /**
   * 解析上传的文件，根据类型分流：
   * - .md → 直接解析，扫描本地图片引用
   * - .docx/.pdf 等 → 通过 MinerU API 转换为 markdown + 图片
   *
   * 结果暂存到 MinIO，返回 parseId 供后续步骤使用。
   */
  async parse(fileName: string, buffer: Buffer): Promise<ParseResultDto> {
    const parseId = randomUUID().replace(/-/g, '').slice(0, 16);
    const title = parsePath(fileName).name;
    const ext = parsePath(fileName).ext.toLowerCase();

    let markdown: string;
    const assets: AssetRefDto[] = [];

    if (MINERU_EXTENSIONS.has(ext)) {
      // docx/pdf 等：走 MinerU 云端转换
      const result = await this.mineruService.convert(fileName, buffer);
      markdown = result.markdown;

      // MinerU 提取的图片直接存入 MinIO 临时目录，标记为 resolved
      for (const [imgName, imgBuffer] of result.images) {
        await this.minioService.putObject(
          `${IMPORT_PREFIX}/${parseId}/assets/${imgName}`,
          imgBuffer,
          this.guessMimeType(imgName),
        );
        // 查找 markdown 中对应的引用路径
        const ref = this.findImageRef(markdown, imgName);
        if (ref) {
          assets.push({ ref, filename: imgName, status: 'resolved' });
        }
      }
    } else {
      // .md 文件：直接读取文本
      markdown = buffer.toString('utf-8');
    }

    // 通用后处理
    markdown = this.normalizeHeadingLevels(markdown);
    markdown = markdown.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>');
    // LaTeX 公式 → inline code（Plate 不支持 LaTeX，$..$ 会导致 remarkMdx 解析崩溃）
    markdown = markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => '\n```\n' + tex.trim() + '\n```\n');
    markdown = markdown.replace(/\$([^\n$]+?)\$/g, '`$1`');
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    // 扫描本地图片引用（.md 文件的图片，或 MinerU 结果中未匹配的引用）
    const localImageRegex = /!\[([^\]]*)\]\(((?!https?:\/\/)[^)]+)\)/g;
    const resolvedFiles = new Set(assets.map((a) => a.filename));
    let match: RegExpExecArray | null;
    while ((match = localImageRegex.exec(markdown)) !== null) {
      const ref = match[2];
      const filename = parsePath(ref).base;
      if (resolvedFiles.has(filename)) continue;
      resolvedFiles.add(filename);
      assets.push({ ref, filename, status: 'missing' });
    }

    // MongoDB 存会话元数据，MinIO 存 markdown 文本
    await this.importSessionRepo.create({ id: parseId, title, assets });
    await this.minioService.putObject(
      `${IMPORT_PREFIX}/${parseId}/content.md`,
      Buffer.from(markdown, 'utf-8'),
      'text/markdown',
    );

    return { parseId, title, markdown, assets };
  }

  /** 根据 parseId 获取解析结果（MongoDB 元数据 + MinIO markdown） */
  async getParse(parseId: string): Promise<ParseResultDto> {
    const session = await this.importSessionRepo.findById(parseId);
    if (!session) throw new NotFoundException('导入会话不存在或已过期');

    const mdBuffer = await this.minioService.getObject(`${IMPORT_PREFIX}/${parseId}/content.md`);
    return {
      parseId,
      title: session.title,
      markdown: mdBuffer.toString('utf-8'),
      assets: session.assets,
    };
  }

  /** 在 markdown 中查找引用某个图片文件名的路径 */
  private findImageRef(markdown: string, imgName: string): string | null {
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
      if (m[2].includes(imgName)) return m[2];
    }
    return null;
  }

  /** 根据扩展名推断 MIME 类型 */
  private guessMimeType(fileName: string): string {
    const ext = parsePath(fileName).ext.toLowerCase();
    const map: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    };
    return map[ext] || 'application/octet-stream';
  }

  /**
   * 接收用户补传的文件，按文件名匹配缺失资源，
   * 匹配到的文件存入 MinIO 临时目录。
   */
  async resolveAssets(
    parseId: string,
    files: { filename: string; buffer: Buffer; mimetype: string }[],
  ): Promise<AssetRefDto[]> {
    const session = await this.importSessionRepo.findById(parseId);
    if (!session) throw new NotFoundException('导入会话不存在或已过期');

    const assets = [...session.assets];
    const missingMap = new Map<string, number>();
    assets.forEach((asset, i) => {
      if (asset.status === 'missing') missingMap.set(asset.filename.toLowerCase(), i);
    });

    for (const file of files) {
      const basename = parsePath(file.filename).base.toLowerCase();
      const idx = missingMap.get(basename);
      if (idx !== undefined) {
        await this.minioService.putObject(
          `${IMPORT_PREFIX}/${parseId}/assets/${assets[idx].filename}`,
          file.buffer,
          file.mimetype,
        );
        assets[idx].status = 'resolved';
        missingMap.delete(basename);
      }
    }

    // 更新 MongoDB 资源状态
    await this.importSessionRepo.updateAssets(parseId, assets);
    return assets;
  }

  /**
   * 确认导入：单次 commit 创建 content item + structure node。
   * 直接使用底层服务，避免 createContent+saveContent 产生两次提交。
   */
  async confirm(dto: ConfirmImportDto): Promise<{ nodeId: string; contentItemId: string }> {
    const session = await this.importSessionRepo.findById(dto.parseId);
    if (!session) throw new NotFoundException('导入会话不存在或已过期');

    const mdBuffer = await this.minioService.getObject(`${IMPORT_PREFIX}/${dto.parseId}/content.md`);
    const rawMarkdown = mdBuffer.toString('utf-8');
    const title = dto.title || session.title;
    const now = new Date();
    const contentId = `ci_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    await this.contentGitService.prepareWritableWorkspace();

    // 存储已匹配的资源到 git 仓库，收集路径映射
    const pathMap = new Map<string, string>();
    for (const asset of session.assets) {
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
    let body = rawMarkdown;
    for (const asset of session.assets) {
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
      createdAt: now,
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

    // 清理临时数据（MongoDB + MinIO）
    await this.importSessionRepo.deleteById(dto.parseId);
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

  /**
   * 兜底清理：MongoDB TTL index 自动删 session 记录，
   * 这里清理可能残留的 MinIO 孤立文件。
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOrphanedFiles() {
    try {
      const keys = await this.minioService.listByPrefix(`${IMPORT_PREFIX}/`);
      if (keys.length === 0) return;

      const parseIds = new Set<string>();
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length >= 2) parseIds.add(parts[1]);
      }

      // 检查 MongoDB 中是否还有对应 session，没有则清理 MinIO
      for (const parseId of parseIds) {
        const session = await this.importSessionRepo.findById(parseId);
        if (!session) {
          await this.minioService.removeByPrefix(`${IMPORT_PREFIX}/${parseId}/`);
          this.logger.log(`Cleaned orphaned import files: ${parseId}`);
        }
      }
    } catch {
      // MinIO 不可用时静默忽略
    }
  }
}
