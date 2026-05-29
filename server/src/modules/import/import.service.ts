import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { parse as parsePath } from 'path';
import { OssService } from '../oss/oss.service';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentService } from '../content/content.service';
import { nanoid } from 'nanoid';
import { NavigationNodeService } from '../navigation/navigation.service';
import { MineruService } from './mineru.service';
import { ImportSessionRepository } from './import-session.repository';
import { BatchImportSessionRepository } from './batch-import-session.repository';
import { AssetRefDto, ParseResultDto } from './dto/parse-result.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import type { FastifyReply } from 'fastify';
import { processMarkdown } from './markdown-post-processor';
import { NavigationRepository } from '../navigation/navigation.repository';
import {
  ContentChangeType,
  type ContentVersion,
  type ContentChangeLog,
} from '../content/content-item.entity';

/** 需要通过 MinerU 转换的文件扩展名 */
const MINERU_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.pptx', '.ppt']);

/** MinIO 中 import 临时文件的前缀 */
const IMPORT_PREFIX = 'import-temp';

export interface BatchJobProgress {
  total: number;
  completed: number;
  status: 'processing' | 'done' | 'failed';
  foldersCreated: number;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  /** 内存进度表：jobId → 实时进度（个人单机，不需要持久化） */
  private readonly jobProgress = new Map<string, BatchJobProgress>();

  constructor(
    private readonly minioService: OssService,
    private readonly mineruService: MineruService,
    private readonly importSessionRepo: ImportSessionRepository,
    private readonly batchSessionRepo: BatchImportSessionRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    // contentRepository 保留：archiveBatchToGit 中需要查询/更新 ContentItem 回填 commitHash
    private readonly contentRepository: ContentRepository,
    // snapshotRepository 保留：archiveBatchToGit 中需要回填 snapshot.commitHash
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly contentService: ContentService,
    private readonly navigationNodeService: NavigationNodeService,
    private readonly navigationRepository: NavigationRepository,
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

    // 通用后处理：标题归一化、HTML→md、LaTeX→code、花括号转义、空行收窄
    markdown = processMarkdown(markdown);

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

    const mdBuffer = await this.minioService.getObject(
      `${IMPORT_PREFIX}/${parseId}/content.md`,
    );
    let markdown = mdBuffer.toString('utf-8');

    // 将已 resolved 的图片路径改写为预览 API URL
    for (const asset of session.assets) {
      if (asset.status === 'resolved') {
        markdown = markdown
          .split(asset.ref)
          .join(
            `/api/v1/spaces/notes/import/parse/${parseId}/assets/${asset.filename}`,
          );
      }
    }

    return { parseId, title: session.title, markdown, assets: session.assets };
  }

  /** 预览阶段提供图片访问 */
  async getPreviewAsset(
    parseId: string,
    fileName: string,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const buffer = await this.minioService.getObject(
        `${IMPORT_PREFIX}/${parseId}/assets/${fileName}`,
      );
      const contentType = this.guessMimeType(fileName);
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'max-age=300');
      reply.send(buffer);
    } catch (err: unknown) {
      // MinIO 对象不存在或不可用，统一返回 404
      this.logger.warn(
        `getPreviewAsset: 读取资产失败 (${parseId}/${fileName}): ${err instanceof Error ? err.message : String(err)}`,
      );
      reply.status(404).send({ message: 'Asset not found' });
    }
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
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
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
      if (asset.status === 'missing')
        missingMap.set(asset.filename.toLowerCase(), i);
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
  async confirm(
    dto: ConfirmImportDto,
  ): Promise<{ nodeId: string; contentItemId: string }> {
    const session = await this.importSessionRepo.findById(dto.parseId);
    if (!session) throw new NotFoundException('导入会话不存在或已过期');

    const mdBuffer = await this.minioService.getObject(
      `${IMPORT_PREFIX}/${dto.parseId}/content.md`,
    );
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
        // 写到 OSS 永久位置
        const permanentKey = `assets/${contentId}/${stored.fileName}`;
        await this.minioService
          .putObject(permanentKey, buf, this.guessMimeType(asset.filename))
          .catch(() => {});
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
      {
        id: contentId,
        _id: contentId,
        latestVersion: { commitHash: '', title, summary: title },
        changeLogs: [changeLog],
        createdAt: now,
        updatedAt: now,
      },
      source.assetRefs,
    );

    // V2: 通过 ContentService 公共 API 创建 ContentSnapshot + ContentItem，
    // 避免绕过版本管理协议直接操作底层 Repository。
    // contentId 由外部提前生成（第 252 行），以便在此之前完成资源迁移和磁盘写入。
    const { versionId } = await this.contentService.importContent({
      contentId,
      title,
      bodyMarkdown: body,
      changeNote,
      assetRefs: this.contentRepoService
        .extractAssetRefs(body)
        .map((ref) => ref.path),
      createdAt: now,
    });

    // TODO: Phase 3 后续优化——import confirm 当前仍同步执行 Git commit，
    // 因导入是低频操作且需要 commitHash 做节点关联，暂保留同步方式。
    // 如需异步化，可参考 ContentService.archiveToGit 的 fire-and-forget 模式。
    let commitHash: string | null;
    try {
      commitHash = await this.contentGitService.recordCommittedContentChange(
        contentId,
        changeNote,
      );
    } catch {
      // Git 失败 → 回滚 ContentItem，保留 session 和临时文件供用户重试
      await this.contentRepository.deleteById(contentId);
      throw new BadRequestException('导入提交失败：Git commit error');
    }

    if (!commitHash) {
      await this.contentRepository.deleteById(contentId);
      throw new BadRequestException('导入提交失败：无变更可提交');
    }

    // 回填真实 commitHash 到 ContentItem 和 ContentSnapshot
    await this.contentRepository.update(contentId, {
      latestVersion: { versionId, commitHash, title, summary: title },
      changeLogs: [{ ...changeLog, commitHash }],
      updatedAt: now,
    });
    await this.snapshotRepository.backfillCommitHash(versionId, commitHash);

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

  // ─── 批量导入 ───

  /**
   * 批量解析：接收多个 .md 文件 + 各自匹配的资源，一次返回全部解析结果。
   * 每个文件独立创建 ImportSession（复用 TTL 清理逻辑），
   * 外层用 BatchImportSession 聚合。
   */
  async batchParse(
    parentId: string,
    files: Array<{
      relativePath: string;
      buffer: Buffer;
      assets?: Array<{ filename: string; buffer: Buffer }>;
    }>,
  ): Promise<{
    batchId: string;
    items: Array<{
      relativePath: string;
      parseId: string;
      title: string;
      missingAssets: string[];
    }>;
  }> {
    const batchId = nanoid(16);
    const items: Array<{
      relativePath: string;
      parseId: string;
      title: string;
      missingAssets: string[];
    }> = [];

    for (const file of files) {
      const parseId = randomUUID().replace(/-/g, '').slice(0, 16);
      const pathParts = parsePath(file.relativePath);
      const title = pathParts.name;

      // 解析 markdown
      let markdown = file.buffer.toString('utf-8');
      markdown = processMarkdown(markdown);

      const assets: AssetRefDto[] = [];

      // 存储已匹配的资源
      if (file.assets) {
        for (const asset of file.assets) {
          await this.minioService.putObject(
            `${IMPORT_PREFIX}/${parseId}/assets/${asset.filename}`,
            asset.buffer,
            this.guessMimeType(asset.filename),
          );
          // 找到 markdown 中对应的 ref
          const ref = this.findImageRef(markdown, asset.filename);
          if (ref) {
            assets.push({ ref, filename: asset.filename, status: 'resolved' });
          }
        }
      }

      // 扫描未解析的本地图片引用
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

      // 存储 session + markdown
      await this.importSessionRepo.create({ id: parseId, title, assets });
      await this.minioService.putObject(
        `${IMPORT_PREFIX}/${parseId}/content.md`,
        Buffer.from(markdown, 'utf-8'),
        'text/markdown',
      );

      items.push({
        relativePath: file.relativePath,
        parseId,
        title,
        missingAssets: assets
          .filter((a) => a.status === 'missing')
          .map((a) => a.filename),
      });
    }

    // 创建批量会话
    await this.batchSessionRepo.create({
      id: batchId,
      parentId,
      items: items.map((i) => ({
        parseId: i.parseId,
        relativePath: i.relativePath,
        title: i.title,
      })),
    });

    return { batchId, items };
  }

  /** 获取批量会话信息（预览页刷新时恢复） */
  async getBatchSession(batchId: string) {
    const session = await this.batchSessionRepo.findById(batchId);
    if (!session) throw new NotFoundException('批量导入会话不存在或已过期');
    return session;
  }

  /** 取消批量导入：立即清理所有关联的 session 和 OSS 临时文件 */
  async cancelBatch(batchId: string): Promise<void> {
    const session = await this.batchSessionRepo.findById(batchId);
    if (!session) return; // 已过期则静默返回
    for (const item of session.items) {
      await this.importSessionRepo.deleteById(item.parseId).catch(() => {});
      await this.minioService
        .removeByPrefix(`${IMPORT_PREFIX}/${item.parseId}/`)
        .catch(() => {});
    }
    await this.batchSessionRepo.deleteById(batchId).catch(() => {});
    this.logger.log(`Batch import cancelled and cleaned: ${batchId}`);
  }

  /** 取消单文件导入：立即清理 session 和 OSS 临时文件 */
  /** 查询批量导入任务的实时进度 */
  getBatchJobProgress(jobId: string): BatchJobProgress | null {
    return this.jobProgress.get(jobId) ?? null;
  }

  async cancelParse(parseId: string): Promise<void> {
    await this.importSessionRepo.deleteById(parseId).catch(() => {});
    await this.minioService
      .removeByPrefix(`${IMPORT_PREFIX}/${parseId}/`)
      .catch(() => {});
  }

  /**
   * 批量确认导入：仅验证后立即返回 jobId，所有实际工作在后台完成。
   * 前端通过 getBatchJobProgress 轮询进度。
   */
  async batchConfirm(dto: {
    batchId: string;
    parentId: string;
    selectedPaths: string[];
  }): Promise<{ jobId: string; foldersCreated: number; docsCreated: number }> {
    const batchSession = await this.batchSessionRepo.findById(dto.batchId);
    if (!batchSession)
      throw new NotFoundException('批量导入会话不存在或已过期');

    const selectedSet = new Set(dto.selectedPaths);
    const selectedItems = batchSession.items.filter((i) =>
      selectedSet.has(i.relativePath),
    );

    if (selectedItems.length === 0) {
      throw new BadRequestException('未选择任何文件');
    }

    const jobId = nanoid(12);
    this.jobProgress.set(jobId, {
      total: selectedItems.length,
      completed: 0,
      status: 'processing',
      foldersCreated: 0,
    });

    // 全部后台执行（FOLDER 创建 + 内容处理 + Git + 清理）
    void this.processBatchItems(jobId, selectedItems, dto.parentId);

    return { jobId, foldersCreated: 0, docsCreated: selectedItems.length };
  }

  /**
   * 后台并行处理批量导入的文件内容。
   * 每个文件独立处理（资源迁移 + 写磁盘 + MongoDB + NavigationNode），
   * 最后统一做一次 Git commit + 清理。
   */
  private async processBatchItems(
    jobId: string,
    items: Array<{ parseId: string; relativePath: string; title: string }>,
    rootParentId: string,
  ): Promise<void> {
    const progress = this.jobProgress.get(jobId)!;
    try {
      // 1. 创建 FOLDER 结构
      const folderMap = new Map<string, string>();
      folderMap.set('', rootParentId);

      const dirPaths = new Set<string>();
      for (const item of items) {
        const parts = item.relativePath.split('/');
        for (let i = 1; i < parts.length; i++) {
          dirPaths.add(parts.slice(0, i).join('/'));
        }
      }
      const sortedDirs = [...dirPaths].sort(
        (a, b) => a.split('/').length - b.split('/').length,
      );
      for (const dirPath of sortedDirs) {
        const parts = dirPath.split('/');
        const folderName = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join('/');
        const parentNodeId = folderMap.get(parentPath) ?? rootParentId;
        const existingChildren =
          await this.navigationRepository.findChildrenByParentId(parentNodeId);
        const existing = existingChildren.find((n) => n.name === folderName);
        if (existing) {
          folderMap.set(dirPath, existing._id.toString());
        } else {
          const node = await this.navigationNodeService.createStructureNode({
            name: folderName,
            type: 'FOLDER',
            parentId: parentNodeId,
          });
          folderMap.set(dirPath, node.id);
          progress.foldersCreated++;
        }
      }

      // 2. 预计算每个文件在父目录内的 sortOrder（并行处理不影响最终顺序）
      const sortOrderByIdx = new Map<number, number>();
      const parentOrderCounter = new Map<string, number>();
      for (let i = 0; i < items.length; i++) {
        const parts = items[i].relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const order = parentOrderCounter.get(parentPath) ?? 0;
        sortOrderByIdx.set(i, order);
        parentOrderCounter.set(parentPath, order + 1);
      }

      // 3. 有限并发处理文件内容（避免同时打开过多 OSS 连接 / 磁盘 I/O）
      await this.contentGitService.prepareWritableWorkspace();
      const now = new Date();
      const contentIds: string[] = Array.from(
        { length: items.length },
        () => '',
      );
      const CONCURRENCY = 5;

      for (let start = 0; start < items.length; start += CONCURRENCY) {
        const chunk = items.slice(start, start + CONCURRENCY);
        await Promise.all(
          chunk.map(async (item, i) => {
            const idx = start + i;
            try {
              const contentId = await this.processOneItem(item, now);
              contentIds[idx] = contentId;

              const parts = item.relativePath.split('/');
              const parentPath = parts.slice(0, -1).join('/');
              const parentNodeId = folderMap.get(parentPath) ?? rootParentId;
              await this.navigationNodeService.createStructureNode({
                name: item.title,
                type: 'DOC',
                parentId: parentNodeId,
                contentItemId: contentId,
                sortOrder: sortOrderByIdx.get(idx) ?? idx,
              });
            } catch (err) {
              this.logger.warn(
                `Batch item failed: ${item.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            progress.completed++;
          }),
        );
      }

      // 3. Git + 清理
      const validIds = contentIds.filter(Boolean);
      if (validIds.length > 0) {
        void this.archiveBatchToGit(validIds, validIds.length);
      }

      await Promise.all(
        items.map(async (item) => {
          await this.importSessionRepo.deleteById(item.parseId).catch(() => {});
          await this.minioService
            .removeByPrefix(`${IMPORT_PREFIX}/${item.parseId}/`)
            .catch(() => {});
        }),
      );

      progress.status = 'done';
      this.logger.log(
        `Batch import done: ${validIds.length}/${items.length} items`,
      );
      setTimeout(() => this.jobProgress.delete(jobId), 30_000);
    } catch (err) {
      progress.status = 'failed';
      this.logger.error(
        `Batch import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => this.jobProgress.delete(jobId), 30_000);
    }
  }

  /** 处理单个导入文件：OSS 读取 → 资源迁移 → 写磁盘 → 创建 MongoDB 记录 */
  private async processOneItem(
    item: { parseId: string; relativePath: string; title: string },
    now: Date,
  ): Promise<string> {
    const session = await this.importSessionRepo.findById(item.parseId);
    if (!session) throw new Error(`Session ${item.parseId} not found`);

    const mdBuffer = await this.minioService.getObject(
      `${IMPORT_PREFIX}/${item.parseId}/content.md`,
    );
    const rawMarkdown = mdBuffer.toString('utf-8');
    const title = item.title;
    const contentId = `ci_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    // 并行读取所有已解析的资源
    const resolvedAssets = session.assets.filter(
      (a) => a.status === 'resolved',
    );
    const assetResults = await Promise.all(
      resolvedAssets.map(async (asset) => {
        try {
          const buf = await this.minioService.getObject(
            `${IMPORT_PREFIX}/${item.parseId}/assets/${asset.filename}`,
          );
          const stored = await this.contentRepoService.storeAsset(
            contentId,
            asset.filename,
            buf,
          );
          // 同步写到 OSS 永久位置（导入路径不走 draft → promote 流程）
          const permanentKey = `assets/${contentId}/${stored.fileName}`;
          await this.minioService
            .putObject(permanentKey, buf, this.guessMimeType(asset.filename))
            .catch(() => {});
          return {
            ref: asset.ref,
            filename: asset.filename,
            path: stored.path,
          };
        } catch {
          return null;
        }
      }),
    );

    // 重写 markdown 中的图片路径
    let body = rawMarkdown;
    for (const result of assetResults) {
      if (result) body = body.split(result.ref).join(result.path);
    }
    body = body || '\u200B';

    // 写入磁盘
    await this.contentRepoService.writeMainMarkdown(contentId, body);
    const source = await this.contentRepoService.readContentSource(contentId);
    const changeNote = '从文件夹导入';
    const changeLog = {
      title,
      summary: title,
      changeNote,
      changeType: ContentChangeType.major,
      createdAt: now,
    };
    await this.contentRepoService.writeReadme(
      {
        id: contentId,
        _id: contentId,
        latestVersion: { commitHash: '', title, summary: title },
        changeLogs: [changeLog],
        createdAt: now,
        updatedAt: now,
      },
      source.assetRefs,
    );

    // V2: 通过 ContentService 公共 API 创建 ContentSnapshot + ContentItem，
    // contentId 由外部提前生成，以便在此之前完成资源迁移和磁盘写入。
    await this.contentService.importContent({
      contentId,
      title,
      bodyMarkdown: body,
      changeNote,
      assetRefs: this.contentRepoService
        .extractAssetRefs(body)
        .map((ref) => ref.path),
      createdAt: now,
    });

    return contentId;
  }

  /** 异步归档到 Git：单次 commit + 回填 commitHash。失败不影响已创建的 MongoDB 数据。 */
  private async archiveBatchToGit(
    contentIds: string[],
    fileCount: number,
  ): Promise<void> {
    try {
      const commitHash = await this.contentGitService.recordBatchCommit(
        contentIds,
        `文件夹导入 ${fileCount} 篇`,
      );
      if (!commitHash) return;
      for (const contentId of contentIds) {
        const content = await this.contentRepository.findById(contentId);
        if (!content?.latestVersion) continue;
        await this.contentRepository.update(contentId, {
          latestVersion: {
            ...(JSON.parse(
              JSON.stringify(content.latestVersion),
            ) as ContentVersion),
            commitHash,
          },
          changeLogs: content.changeLogs.map((log) => ({
            ...(JSON.parse(JSON.stringify(log)) as ContentChangeLog),
            commitHash,
          })),
          updatedAt: new Date(),
        });
        if (content.latestVersion.versionId) {
          await this.snapshotRepository
            .backfillCommitHash(content.latestVersion.versionId, commitHash)
            .catch(() => {});
        }
      }
      this.logger.log(`Batch git archive done: ${commitHash}`);
    } catch (err) {
      this.logger.warn(
        `Batch git archive failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 兜底清理：MongoDB TTL index 自动删 session 记录，
   * 这里清理可能残留的 MinIO 孤立文件。
   */
  /** 每周日凌晨 4 点兜底清理——正常流程下取消/成功都会立即清理，这里只处理异常残留 */
  @Cron('0 4 * * 0')
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
          await this.minioService.removeByPrefix(
            `${IMPORT_PREFIX}/${parseId}/`,
          );
          this.logger.log(`Cleaned orphaned import files: ${parseId}`);
        }
      }
    } catch (err: unknown) {
      // MinIO 不可用时静默忽略，但记录 warn 以便排查
      this.logger.warn(
        `cleanupOrphanedFiles: 清理失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
