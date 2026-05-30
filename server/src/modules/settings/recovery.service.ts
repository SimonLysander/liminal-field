/**
 * RecoveryService — 从 Git 仓库恢复 MongoDB 数据。
 *
 * 适用场景：MongoDB 数据丢失（如误删、备份失效），而 Git 仓库完好。
 * 扫描 Git 仓库 content/ 目录，与 MongoDB 对比，
 * 恢复缺失的 ContentItem + ContentSnapshot + NavigationNode。
 *
 * 恢复策略：
 * 1. 有清单（.liminal-field.yaml）→ 按清单还原树形导航结构
 * 2. 无清单 → 平铺到 notes scope 根节点
 */
import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, stat } from 'fs/promises';
import { extname, join } from 'path';
import { nanoid } from 'nanoid';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { NavigationRepository } from '../navigation/navigation.repository';
import { ContentService } from '../content/content.service';
import { OssService } from '../oss/oss.service';
import { Manifest, ManifestNode, ManifestService } from './manifest.service';

export interface ScanResult {
  /** Git 仓库 content/ 目录下发现的 contentId 列表 */
  gitItems: string[];
  /** MongoDB 中已存在的 contentId 列表 */
  dbItems: string[];
  /** 在 Git 中存在但 MongoDB 中缺失 */
  missingInDb: string[];
  /** 在 MongoDB 中存在但 Git 中没有对应目录（孤儿记录） */
  orphanedInDb: string[];
  /** 是否存在清单文件，供前端决定是否展示树形预览 */
  hasManifest: boolean;
}

export interface ExecuteResult {
  recovered: number;
  errors: string[];
}

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);
  private readonly repoRoot: string;
  private readonly contentRoot: string;

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentSnapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly ossService: OssService,
    private readonly manifestService: ManifestService,
    private readonly contentService: ContentService,
  ) {
    this.repoRoot = this.contentRepoService.repoRoot;
    this.contentRoot = join(this.repoRoot, 'content');
  }

  /**
   * 扫描阶段：对比 Git 仓库与 MongoDB，返回差异报告。
   * 纯读操作，不修改任何数据。
   */
  async scan(): Promise<ScanResult> {
    const gitItems = await this.listGitContentIds();
    const dbItems = await this.listDbContentIds();

    const gitSet = new Set(gitItems);
    const dbSet = new Set(dbItems);

    const missingInDb = gitItems.filter((id) => !dbSet.has(id));
    const orphanedInDb = dbItems.filter((id) => !gitSet.has(id));
    const hasManifest = await this.manifestService.manifestExists();

    this.logger.log(
      `Scan: git=${gitItems.length}, db=${dbItems.length}, missing=${missingInDb.length}, orphaned=${orphanedInDb.length}`,
    );

    return { gitItems, dbItems, missingInDb, orphanedInDb, hasManifest };
  }

  /**
   * 执行阶段：逐条恢复缺失的内容，包括 ContentItem、Snapshot、NavigationNode。
   *
   * @param contentIds 要恢复的 contentId 列表；若未传，先 scan 后取 missingInDb
   */
  async execute(contentIds?: string[]): Promise<ExecuteResult> {
    // 未指定时，先扫描再确定要恢复的 ID 列表
    const targetIds = contentIds ?? (await this.scan()).missingInDb;

    // 从清单构建 contentId → scope 映射，决定恢复策略
    const manifest = await this.manifestService.readManifest();
    const scopeMap = this.buildScopeMap(manifest);

    const recoveredIds = new Set<string>();
    const errors: string[] = [];

    for (const contentId of targetIds) {
      try {
        const scope = scopeMap.get(contentId) ?? 'notes';
        await this.recoverSingleItem(contentId, scope, recoveredIds);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`恢复 ${contentId} 失败: ${msg}`);
        errors.push(`${contentId}: ${msg}`);
      }
    }

    // 最后统一恢复导航节点：有清单按树形恢复，无清单平铺到 notes 根
    await this.restoreNavigation(manifest, recoveredIds);

    this.logger.log(
      `Recovery complete: ${recoveredIds.size} recovered, ${errors.length} errors`,
    );

    return { recovered: recoveredIds.size, errors };
  }

  /** 从清单导航树提取 contentId → scope 映射 */
  private buildScopeMap(manifest: Manifest | null): Map<string, string> {
    const map = new Map<string, string>();
    if (!manifest) return map;
    for (const [scope, nodes] of Object.entries(manifest.navigation)) {
      const collect = (list: ManifestNode[]) => {
        for (const node of list) {
          if (node.contentItemId) map.set(node.contentItemId, scope);
          if (node.children) collect(node.children);
        }
      };
      collect(nodes);
    }
    return map;
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  /** 列出 content/ 目录下第一层子目录名（即 contentId 列表） */
  private async listGitContentIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.contentRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // content/ 目录不存在时返回空数组（新仓库场景）
      return [];
    }
  }

  /** 查询 MongoDB 中全部 ContentItem 的 ID */
  private async listDbContentIds(): Promise<string[]> {
    const items = await this.contentRepository.listAll();
    return items.map((item) => item._id);
  }

  /**
   * 恢复单条内容：读 main.md，创建一条 snapshot（fileName=null）。
   *
   * 统一页面树后（2026-05-29）所有 scope 同质——文集条目各自是独立的 ContentItem
   * （独立 content/<ci> 目录），同样走本方法逐条恢复；父子结构由清单导航树还原
   * （restoreNavigation → createNodesFromManifest），不再有 anthology 专属的 entries 扫描。
   */
  private async recoverSingleItem(
    contentId: string,
    scope: string,
    recoveredIds: Set<string>,
  ): Promise<void> {
    const contentDir = join(this.contentRoot, contentId);

    // 跳过 content/ 目录不存在的 ID（防御性处理）
    try {
      await stat(contentDir);
    } catch {
      this.logger.warn(`recoverSingleItem: 目录不存在，跳过 ${contentId}`);
      return;
    }

    // 读取 main.md（所有 scope 都有）
    let bodyMarkdown = '';
    try {
      bodyMarkdown = await readFile(join(contentDir, 'main.md'), 'utf8');
    } catch {
      this.logger.warn(`${contentId}: main.md 不存在，正文为空`);
    }

    // 解析 README.md 取标题与摘要
    let readmeContent = '';
    try {
      readmeContent = await readFile(join(contentDir, 'README.md'), 'utf8');
    } catch {
      // README 不存在也能继续，用 contentId 作 fallback
    }
    const { title, summary } = this.parseReadme(readmeContent, contentId);

    const latestVersionId = nanoid(16);
    const now = new Date();

    // 创建 ContentItem
    await this.contentRepository.create({
      id: contentId,
      latestVersion: {
        versionId: latestVersionId,
        commitHash: '',
        title,
        summary,
      },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    });

    // 索引 snapshot（main.md，fileName=null）
    await this.contentSnapshotRepository.create({
      versionId: latestVersionId,
      contentItemId: contentId,
      title,
      summary,
      bodyMarkdown,
      assetRefs: [],
      createdAt: now,
      changeNote: '从远端恢复',
      source: 'system',
    });

    // 上传最新版本资产到 OSS
    await this.uploadAssetsToOss(contentId, latestVersionId, contentDir);

    recoveredIds.add(contentId);
    this.logger.log(`恢复完成: ${contentId} (${title}) [${scope}]`);
  }

  /**
   * 为「清单记了 contentItemId、但 Git 无其 content/ 目录」的空壳文件夹补建一个空 ContentItem
   * (+ 一条空正文 snapshot),用原 id,使导航节点能解析、详情可读(空正文),不留悬挂死节点。
   * 幂等:该 id 已存在(理论上不会,防御)则直接返回。
   */
  private async ensureEmptyContentItem(
    contentId: string,
    title: string,
  ): Promise<void> {
    if (await this.contentRepository.findById(contentId)) return;

    const versionId = nanoid(16);
    const now = new Date();
    await this.contentRepository.create({
      id: contentId,
      latestVersion: { versionId, commitHash: '', title, summary: '' },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.contentSnapshotRepository.create({
      versionId,
      contentItemId: contentId,
      title,
      summary: '',
      bodyMarkdown: '',
      assetRefs: [],
      createdAt: now,
      changeNote: '恢复:补建空壳文件夹内容',
      source: 'system',
    });
    this.logger.log(`补建空壳文件夹内容: ${contentId} (${title})`);
  }

  /**
   * 解析 README.md，提取标题（第一个 # 行）和摘要（标题后第一个非空段落）。
   * 文件不存在或格式异常时用 fallback。
   */
  private parseReadme(
    content: string,
    fallbackTitle: string,
  ): { title: string; summary: string } {
    const lines = content.split('\n');
    const titleLine = lines.find((line) => line.startsWith('# '));
    const title = titleLine?.slice(2).trim() ?? fallbackTitle;

    // 摘要：标题后第一个非空、非标题、非列表行
    let summary = '';
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith('# ')) {
        foundTitle = true;
        continue;
      }
      if (
        foundTitle &&
        line.trim() &&
        !line.startsWith('#') &&
        !line.startsWith('-')
      ) {
        summary = line.trim();
        break;
      }
    }

    return { title, summary };
  }

  /**
   * 将 content/<id>/assets/ 下的文件上传到 OSS。
   * OSS key 格式：assets/<contentId>/<versionId>/<fileName>
   * 只上传最新版本——历史版本资产在绝大多数场景共用同一批文件。
   */
  private async uploadAssetsToOss(
    contentId: string,
    latestVersionId: string,
    contentDir: string,
  ): Promise<void> {
    const assetsDir = join(contentDir, 'assets');
    let fileNames: string[];
    try {
      fileNames = await readdir(assetsDir);
    } catch {
      // assets 目录不存在，跳过
      return;
    }

    for (const fileName of fileNames) {
      const filePath = join(assetsDir, fileName);
      try {
        const buffer = await readFile(filePath);
        const mimeType = this.resolveMimeType(fileName);
        const ossKey = `assets/${contentId}/${latestVersionId}/${fileName}`;
        await this.ossService.putObject(ossKey, buffer, mimeType);
      } catch (err: unknown) {
        this.logger.warn(
          `上传资产 ${fileName} 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 恢复导航节点。
   *
   * 有清单 → 按清单树形结构递归创建节点（只创建已恢复内容关联的节点）。
   * 无清单 → 在 notes scope 根节点下为每条内容创建一个平铺的 DOC 节点。
   */
  private async restoreNavigation(
    manifest: Manifest | null,
    recoveredIds: Set<string>,
  ): Promise<void> {
    if (!manifest) {
      // 无清单：平铺恢复，所有内容放到 notes 根节点。
      // order 必须递增 —— 否则同 order=0 多节点的列表顺序退化为 Mongo 内部 _id 序，
      // 与恢复前不一致（虽无清单已无法还原真实顺序，至少保证稳定确定的排列）。
      let order = 0;
      for (const contentId of recoveredIds) {
        const item = await this.contentRepository.findById(contentId);
        if (!item) continue;
        await this.navigationRepository.create({
          name: item.latestVersion?.title ?? contentId,
          scope: 'notes',
          contentItemId: contentId,
          order: order++,
        });
      }
      return;
    }

    // 有清单：按原始树形结构恢复，跳过未恢复的内容节点
    for (const [scope, nodes] of Object.entries(manifest.navigation)) {
      await this.createNodesFromManifest(nodes, scope, null, recoveredIds);
    }
  }

  /**
   * 递归从清单节点创建 NavigationNode。
   *
   * @param nodes 本层节点列表
   * @param scope 业务 scope（notes / gallery）
   * @param parentId 父节点 ObjectId 字符串，根节点时为 null
   * @param recoveredIds 已成功恢复的 contentId 集合
   */
  private async createNodesFromManifest(
    nodes: ManifestNode[],
    scope: string,
    parentId: string | null,
    recoveredIds: Set<string>,
  ): Promise<void> {
    for (const node of nodes) {
      // DOC 节点：只在其关联内容已恢复时才创建
      if (
        node.type === 'DOC' &&
        node.contentItemId &&
        !recoveredIds.has(node.contentItemId)
      ) {
        continue;
      }

      // 节点同质化:每个节点都要指向【真实存在】的 ContentItem。两种情况要补空壳:
      // ① 清单根本没记 contentItemId(老式文件夹节点)→ mint 一个新 id 的空 ContentItem;
      // ② 记了 contentItemId 但它【没被恢复】(git 无其 content/ 目录——空壳文件夹从未提交
      //    正文,recoverSingleItem 不会扫到它)。若直接拿原 id 建导航节点,会得到指向不存在
      //    ContentItem 的悬挂死节点(点开 404)。用【原 id】补建空 ContentItem:既消除悬挂,
      //    又保持与清单一致、跨多次恢复 id 稳定。
      let contentItemId = node.contentItemId;
      if (!contentItemId) {
        const content = await this.contentService.createContent({
          title: node.name,
        });
        contentItemId = content.id;
      } else if (!recoveredIds.has(contentItemId)) {
        await this.ensureEmptyContentItem(contentItemId, node.name);
        recoveredIds.add(contentItemId);
      }
      const created = await this.navigationRepository.create({
        name: node.name,
        scope,
        contentItemId,
        // parentId 存的是 ObjectId，NavigationRepository.create 接受字符串
        parentId: parentId ?? undefined,
        order: node.order,
      });

      // 递归创建子节点，传入新创建节点的 ObjectId
      if (node.children?.length) {
        await this.createNodesFromManifest(
          node.children,
          scope,
          created._id.toString(),
          recoveredIds,
        );
      }
    }
  }

  /**
   * 根据文件名扩展名推断 MIME 类型。
   * 复用与 ContentRepoService 相同的扩展名集合，不引入外部 mime 库。
   */
  private resolveMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.pdf': 'application/pdf',
    };
    return mimeMap[ext] ?? 'application/octet-stream';
  }
}
