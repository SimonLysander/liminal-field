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
import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentStatus } from '../content/content-item.entity';
import { ContentSaveAction } from '../content/dto/save-content.dto';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NavigationNodeType } from '../navigation/navigation.entity';
import { CreateWorkspaceItemDto } from './dto/create-workspace-item.dto';
import { UpdateWorkspaceItemDto } from './dto/update-workspace-item.dto';
import {
  WorkspaceItemDto,
  WorkspaceItemDetailDto,
} from './dto/workspace-item.dto';

// 画廊动态允许无描述，用零宽空格占位通过 ContentService 的 bodyMarkdown 非空校验。
const EMPTY_BODY_PLACEHOLDER = '\u200B';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly navigationRepository: NavigationRepository,
  ) {}

  /**
   * 统一创建条目：写入 Content 存储 + 注册 Navigation 索引。
   * scope 决定该条目归属的业务模块（notes/gallery）。
   */
  async create(
    scope: string,
    dto: CreateWorkspaceItemDto,
  ): Promise<WorkspaceItemDetailDto> {
    const body = dto.bodyMarkdown || EMPTY_BODY_PLACEHOLDER;
    const summary = dto.summary || dto.title;

    const detail = await this.contentService.createContent({
      title: dto.title,
      summary,
      status: ContentStatus.committed,
      bodyMarkdown: body,
      changeNote: dto.changeNote || 'Created',
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
      } catch {
        // 跳过已损坏或已删除的条目
      }
    }
    return items;
  }

  /** 获取条目详情：读取 Content 存储层的 Markdown 源文件 + 元数据。 */
  async getById(
    _scope: string,
    contentItemId: string,
  ): Promise<WorkspaceItemDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content) throw new NotFoundException(`Item ${contentItemId} not found`);

    const source =
      await this.contentRepoService.readContentSource(contentItemId);
    const version = content.latestVersion!;
    const bodyMarkdown =
      source.bodyMarkdown === EMPTY_BODY_PLACEHOLDER
        ? ''
        : source.bodyMarkdown;

    return {
      id: contentItemId,
      title: version.title,
      summary: version.summary,
      status: content.publishedVersion ? 'published' : 'draft',
      bodyMarkdown,
      plainText: source.plainText,
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
    if (!content) throw new NotFoundException(`Item ${contentItemId} not found`);

    const currentVersion = content.latestVersion!;
    const newTitle = dto.title ?? currentVersion.title;
    const newSummary = dto.summary ?? currentVersion.summary;

    let bodyMarkdown: string;
    if (dto.bodyMarkdown !== undefined) {
      bodyMarkdown = dto.bodyMarkdown || EMPTY_BODY_PLACEHOLDER;
    } else {
      const source =
        await this.contentRepoService.readContentSource(contentItemId);
      bodyMarkdown = source.bodyMarkdown;
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
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (navNode) {
      await this.navigationRepository.deleteById(navNode._id.toString());
    }
  }

  /**
   * 发布：publishedVersion 指向指定版本（纯指针操作）。
   * @param commitHash 可选，指定发布哪个历史版本。不传则发布 latestVersion。
   */
  async publish(
    _scope: string,
    contentItemId: string,
    commitHash?: string,
  ): Promise<WorkspaceItemDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content) throw new NotFoundException(`Item ${contentItemId} not found`);

    const version = content.latestVersion!;
    const source =
      await this.contentRepoService.readContentSource(contentItemId);

    await this.contentService.saveContent(contentItemId, {
      title: version.title,
      summary: version.summary,
      status: ContentStatus.committed,
      bodyMarkdown: source.bodyMarkdown,
      changeNote: commitHash
        ? `发布版本 ${commitHash.slice(0, 8)}`
        : 'Published',
      action: ContentSaveAction.publish,
      publishCommitHash: commitHash,
    });

    return this.getById(_scope, contentItemId);
  }

  /** 取消发布：清除 publishedVersion 指针。 */
  async unpublish(
    _scope: string,
    contentItemId: string,
  ): Promise<WorkspaceItemDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content) throw new NotFoundException(`Item ${contentItemId} not found`);

    const version = content.latestVersion!;
    const source =
      await this.contentRepoService.readContentSource(contentItemId);

    await this.contentService.saveContent(contentItemId, {
      title: version.title,
      summary: version.summary,
      status: ContentStatus.published,
      bodyMarkdown: source.bodyMarkdown,
      changeNote: 'Unpublished',
      action: ContentSaveAction.unpublish,
    });

    return this.getById(_scope, contentItemId);
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
    if (!content) throw new NotFoundException(`Item ${contentItemId} not found`);

    const version = content.latestVersion!;
    return {
      id: contentItemId,
      title: version.title,
      summary: version.summary,
      status: content.publishedVersion ? 'published' : 'draft',
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }
}
