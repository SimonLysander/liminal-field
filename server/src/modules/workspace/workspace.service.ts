/**
 * WorkspaceService — scope 驱动的通用 CRUD 薄业务层。
 *
 * 设计定位：Workspace Module 的核心编排服务。
 * - 查 Navigation 索引获取某 scope 下的条目列表
 * - 调 Content 层完成实际读写（Git + MongoDB）
 * - 所有 scope 共享同一套 create/list/getById/update/remove/publish/unpublish 流程
 * - scope 特有逻辑由对应的 ViewService（NoteViewService / GalleryViewService）���理
 *
 * 依赖关系：ContentService + ContentRepository + ContentRepoService（存储层）
 *          + NavigationRepository（业务索引层）
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentStatus } from '../content/content-item.entity';
import { ContentSaveAction } from '../content/dto/save-content.dto';
import { NavigationRepository } from '../navigation/navigation.repository';
import {
  NavigationNodeType,
  NavigationScope,
} from '../navigation/navigation.entity';
import { CreateWorkspaceItemDto } from './dto/create-workspace-item.dto';
import { UpdateWorkspaceItemDto } from './dto/update-workspace-item.dto';
import {
  WorkspaceItemDto,
  WorkspaceItemDetailDto,
} from './dto/workspace-item.dto';

// 画廊动态允许无描述，用零宽空格占位通过 ContentService 的 bodyMarkdown 非空校验。
const EMPTY_BODY_PLACEHOLDER = '\u200B';

function isNavigationScope(s: string): s is NavigationScope {
  return (Object.values(NavigationScope) as string[]).includes(s);
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
  ) {}

  /**
   * 校验 content item 属于指定 scope。
   * 通过导航节点查 scope，不匹配则抛 NotFoundException（对外表现为"不存在"）。
   */
  async assertScopeMatch(scope: string, contentItemId: string): Promise<void> {
    if (!isNavigationScope(scope)) {
      throw new NotFoundException(
        `Item ${contentItemId} not found in scope ${scope}`,
      );
    }
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!navNode || navNode.scope !== scope) {
      throw new NotFoundException(
        `Item ${contentItemId} not found in scope ${scope}`,
      );
    }
  }

  /**
   * 统一创建条目：写入 Content 存储 + 注册 Navigation 索引。
   * scope 决定该条目归属的业务模块（notes/gallery）。
   */
  async create(
    scope: string,
    dto: CreateWorkspaceItemDto,
  ): Promise<WorkspaceItemDetailDto> {
    const summary = dto.summary || dto.title;

    // createContent 只建 MongoDB 记录（无 Git commit），内容通过后续 draft/commit 写入
    const detail = await this.contentService.createContent({
      title: dto.title,
      summary,
    });

    // 在 Navigation 中注册索引，scope 隔离到对应业务模块
    const siblings = await this.navigationRepository.findRootNodes(scope);
    await this.navigationRepository.create({
      name: dto.title,
      scope,
      nodeType: NavigationNodeType.content,
      contentItemId: detail.id,
      order: siblings.length,
    });

    return this.getById(scope, detail.id);
  }

  /**
   * 按 scope 列出条目：从 Navigation 索引查 content 节点，再逐一组装 DTO。
   */
  async list(
    scope: string,
    status?: 'draft' | 'published',
  ): Promise<WorkspaceItemDto[]> {
    const nodes = await this.navigationRepository.findRootNodes(scope);
    const contentNodes = nodes.filter(
      (n) => n.nodeType === NavigationNodeType.content && n.contentItemId,
    );

    const items: WorkspaceItemDto[] = [];
    for (const node of contentNodes) {
      try {
        const item = await this.toListDto(node.contentItemId!);
        if (!status || item.status === status) {
          items.push(item);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping corrupted workspace item ${node.contentItemId}: ${error}`,
        );
      }
    }
    return items;
  }

  /** 获取条目详情：V2 从 ContentSnapshot 读取正文，不再读磁盘文件。 */
  async getById(
    scope: string,
    contentItemId: string,
  ): Promise<WorkspaceItemDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Item ${contentItemId} not found`);

    const version = content.latestVersion!;

    // V2: 从最新版本快照读取正文，替代 readContentSource（不再读磁盘）。
    // 尚无快照（刚创建未提交）时返回空字符串。
    let bodyMarkdown = '';
    const versionId = version.versionId;
    if (versionId) {
      const snapshot = await this.snapshotRepository.findByVersionId(versionId);
      if (snapshot) {
        const rawBody = snapshot.bodyMarkdown;
        // 将 ./assets/ 相对路径改写为 API 绝对路径（与旧 readContentSource 保持一致）
        const versionSuffix = `?v=${versionId}`;
        bodyMarkdown = rawBody
          .replaceAll(
            /\.\/assets\//g,
            `/api/v1/spaces/${scope}/items/${contentItemId}/assets/`,
          )
          .replaceAll(
            new RegExp(
              `/api/v1/spaces/${scope}/items/${contentItemId}/assets/([^)\\s"]+)`,
              'g',
            ),
            (match) => `${match}${versionSuffix}`,
          );
        // 零宽空格占位符（画廊空白正文）对外展示为空字符串
        if (bodyMarkdown === EMPTY_BODY_PLACEHOLDER) {
          bodyMarkdown = '';
        }
      }
    }

    return {
      id: contentItemId,
      title: version.title,
      summary: version.summary,
      // 修正：与 WorkspaceItemDto 声明的 'committed' | 'published' 保持一致
      status: content.publishedVersion ? 'published' : 'committed',
      bodyMarkdown,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /** 更新条目：写入 Content 存储 + 同步 Navigation 节点名称。 */
  async update(
    scope: string,
    contentItemId: string,
    dto: UpdateWorkspaceItemDto,
  ): Promise<WorkspaceItemDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Item ${contentItemId} not found`);

    const currentVersion = content.latestVersion!;
    const newTitle = dto.title ?? currentVersion.title;
    const newSummary = dto.summary ?? currentVersion.summary;

    let bodyMarkdown: string;
    if (dto.bodyMarkdown !== undefined) {
      bodyMarkdown = dto.bodyMarkdown || EMPTY_BODY_PLACEHOLDER;
    } else {
      // V2: 从最新版本快照读取正文（不再读磁盘），供 update 仅改标题/摘要时复用原正文
      const versionId = currentVersion.versionId;
      if (versionId) {
        const snapshot =
          await this.snapshotRepository.findByVersionId(versionId);
        // 快照存原始 ./assets/ 路径，传给 saveContent 写入 Git 前无需改写 API URL
        bodyMarkdown = snapshot?.bodyMarkdown ?? EMPTY_BODY_PLACEHOLDER;
      } else {
        bodyMarkdown = EMPTY_BODY_PLACEHOLDER;
      }
    }

    /* update 永远是业务提交，只更新 latestVersion，不动 publishedVersion */
    await this.contentService.saveContent(contentItemId, {
      title: newTitle,
      summary: newSummary,
      status: ContentStatus.committed,
      bodyMarkdown,
      changeNote: dto.changeNote,
      action: ContentSaveAction.commit,
    });

    // Navigation 节点名称与 Content 标题保持同步
    if (dto.title) {
      const navNode =
        await this.navigationRepository.findByContentItemId(contentItemId);
      if (navNode) {
        await this.navigationRepository.update(navNode._id.toString(), {
          name: dto.title,
        });
      }
    }

    return this.getById(scope, contentItemId);
  }

  /** 删除条目：移除 Navigation 索引（Content 存储保留，由 Git 管理生命周期）。 */
  async remove(_scope: string, contentItemId: string): Promise<void> {
    // 已发布内容不允许直接删除
    const content = await this.contentRepository.findById(contentItemId);
    if (content?.publishedVersion) {
      throw new BadRequestException('已发布内容请先取消发布再删除');
    }
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (navNode) {
      await this.navigationRepository.deleteById(navNode._id.toString());
    }
  }

  /**
   * 发布：publishedVersion 指向指定版本（纯指针操作，不写 Git）。
   * scope 特有校验在此处集中处理（如 gallery 必须有照片才能发布）。
   * @param commitHash 可选，指定发布哪个历史版本。不传则发布 latestVersion。
   */
  async publish(
    scope: string,
    contentItemId: string,
    commitHash?: string,
  ): Promise<void> {
    await this.contentService.publishVersion(contentItemId, commitHash);
  }

  /** 取消发布：清除 publishedVersion 指针（纯指针操作，不写 Git）。 */
  async unpublish(_scope: string, contentItemId: string): Promise<void> {
    await this.contentService.unpublishVersion(contentItemId);
  }

  /**
   * 批量发布：递归发布 folderId 下所有 DOC 节点。
   * 发布是纯 MongoDB 指针操作（不写 Git），并行安全。
   * 跳过无 versionId（未提交）和已是最新的文档。
   */
  async batchPublish(
    folderId: string,
  ): Promise<{ successCount: number; skippedCount: number }> {
    const descendants =
      await this.navigationRepository.findAllDescendants(folderId);
    const docNodes = descendants.filter(
      (n) => n.nodeType === NavigationNodeType.content && n.contentItemId,
    );

    let successCount = 0;
    let skippedCount = 0;

    const results = await Promise.allSettled(
      docNodes.map(async (node) => {
        try {
          await this.contentService.publishVersion(node.contentItemId!);
          successCount++;
        } catch {
          // publishVersion 对已发布且无变更的项抛异常，视为跳过
          skippedCount++;
        }
      }),
    );

    // 记录意外失败
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(`Batch publish item failed: ${r.reason}`);
      }
    }

    return { successCount, skippedCount };
  }

  /**
   * 批量取消发布：递归取消发布 folderId 下所有 DOC 节点。
   */
  async batchUnpublish(
    folderId: string,
  ): Promise<{ successCount: number; skippedCount: number }> {
    const descendants =
      await this.navigationRepository.findAllDescendants(folderId);
    const docNodes = descendants.filter(
      (n) => n.nodeType === NavigationNodeType.content && n.contentItemId,
    );

    let successCount = 0;
    let skippedCount = 0;

    await Promise.allSettled(
      docNodes.map(async (node) => {
        try {
          await this.contentService.unpublishVersion(node.contentItemId!);
          successCount++;
        } catch {
          skippedCount++;
        }
      }),
    );

    return { successCount, skippedCount };
  }

  /** 上传附件到 Content 存储层。 */
  async uploadAsset(
    _scope: string,
    contentItemId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<{ path: string; fileName: string; size: number }> {
    await this.contentService.assertContentItemExists(contentItemId);
    await this.contentService.prepareWritableContentWorkspace();

    const stored = await this.contentRepoService.storeAsset(
      contentItemId,
      fileName,
      buffer,
    );
    return {
      path: stored.path,
      fileName: stored.fileName,
      size: buffer.byteLength,
    };
  }

  /** 列出条目的所有附件。 */
  async listAssets(_scope: string, contentItemId: string) {
    await this.contentService.assertContentItemExists(contentItemId);
    return this.contentRepoService.listAssets(contentItemId);
  }

  /** 将 Content 存储层数据组装为列表 DTO（不含 bodyMarkdown）。 */
  private async toListDto(contentItemId: string): Promise<WorkspaceItemDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Item ${contentItemId} not found`);

    const version = content.latestVersion!;
    return {
      id: contentItemId,
      title: version.title,
      summary: version.summary,
      // 修正：与 WorkspaceItemDto 声明的 'committed' | 'published' 保持一致
      status: content.publishedVersion ? 'published' : 'committed',
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }
}
