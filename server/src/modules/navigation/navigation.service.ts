import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { ContentVisibility } from '../content/dto/content-query.dto';
import { CreateStructureNodeDto } from './dto/create-structure-node.dto';
import { ReorderSiblingsDto } from './dto/reorder-siblings.dto';
import { NavigationRepository } from './navigation.repository';
import { NavigationNodeDto } from './dto/navigation-node.dto';
import { CreateNavigationNodeDto } from './dto/create-navigation-node.dto';
import { StructureNodeDto, StructureListResultDto, DeleteStatsDto } from './dto/structure-node.dto';
import { UpdateNavigationNodeDto } from './dto/update-navigation-node.dto';
import { UpdateStructureNodeDto } from './dto/update-structure-node.dto';
import { NavigationNode, NavigationNodeType } from './navigation.entity';

@Injectable()
export class NavigationNodeService {
  constructor(
    private readonly navigationRepository: NavigationRepository,
    private readonly contentService: ContentService,
  ) {}

  private async toDtos(
    entities: NavigationNode[],
  ): Promise<NavigationNodeDto[]> {
    const childCounts =
      await this.navigationRepository.countChildrenByParentIds(
        entities.map((entity) => entity._id.toString()),
      );

    return entities.map((entity) =>
      NavigationNodeDto.fromEntity(
        entity,
        (childCounts[entity._id.toString()] ?? 0) > 0,
      ),
    );
  }

  private async toStructureDtos(
    entities: NavigationNode[],
  ): Promise<StructureNodeDto[]> {
    const childCounts =
      await this.navigationRepository.countChildrenByParentIds(
        entities.map((entity) => entity._id.toString()),
      );

    return entities.map((entity) =>
      StructureNodeDto.fromEntity(
        entity,
        (childCounts[entity._id.toString()] ?? 0) > 0,
      ),
    );
  }

  /**
   * 过滤当前层级的节点：
   *   - DOC 节点：只保留已发布（可读）的
   *   - FOLDER 节点：只保留其子树中至少存在一个已发布 DOC 的
   *
   * 这样前端展示侧边栏不会出现空文件夹，只展示通向真实内容的路径。
   */
  private async filterReadableStructureNodes(
    entities: NavigationNode[],
    visibility?: ContentVisibility,
  ): Promise<NavigationNode[]> {
    if (visibility === ContentVisibility.all) {
      return entities;
    }

    const readableFlags = await Promise.all(
      entities.map(async (entity) => {
        if (entity.nodeType === NavigationNodeType.content) {
          return this.contentService.isContentItemReadable(
            entity.contentItemId!,
            visibility,
          );
        }

        // FOLDER: 递归检查子树中是否存在可见的叶节点
        return this.hasVisibleDescendant(entity._id.toString(), visibility);
      }),
    );

    return entities.filter((_, index) => readableFlags[index]);
  }

  /**
   * 递归检查某个文件夹下是否存在至少一个可见的 DOC 节点。
   * 个人知识库场景下树规模有限，递归深度可控。
   */
  private async hasVisibleDescendant(
    nodeId: string,
    visibility?: ContentVisibility,
  ): Promise<boolean> {
    const children = await this.navigationRepository.listByParentId(nodeId);

    for (const child of children) {
      if (child.nodeType === NavigationNodeType.content) {
        if (
          await this.contentService.isContentItemReadable(
            child.contentItemId!,
            visibility,
          )
        ) {
          return true;
        }
      } else {
        if (await this.hasVisibleDescendant(child._id.toString(), visibility)) {
          return true;
        }
      }
    }

    return false;
  }

  private toNavigationNodeType(type: 'FOLDER' | 'DOC'): NavigationNodeType {
    return type === 'FOLDER'
      ? NavigationNodeType.subject
      : NavigationNodeType.content;
  }

  private toCreateNavigationNodeDto(
    dto: CreateStructureNodeDto,
  ): CreateNavigationNodeDto {
    return {
      name: dto.name,
      scope: dto.scope,
      parentId: dto.parentId,
      nodeType: this.toNavigationNodeType(dto.type),
      contentItemId: dto.contentItemId,
      order: dto.sortOrder,
    };
  }

  private toUpdateNavigationNodeDto(
    dto: UpdateStructureNodeDto,
  ): UpdateNavigationNodeDto {
    return {
      name: dto.name,
      parentId: dto.parentId,
      contentItemId: dto.contentItemId,
      order: dto.sortOrder,
    };
  }

  private async getParentOrThrow(
    parentId?: string,
  ): Promise<NavigationNode | null> {
    if (!parentId) return null;

    const parent = await this.navigationRepository.findById(parentId);
    if (!parent) {
      throw new NotFoundException(
        `Parent navigation node ${parentId} not found`,
      );
    }
    if (parent.nodeType !== NavigationNodeType.subject) {
      throw new BadRequestException('Only subject nodes can have children');
    }
    return parent;
  }

  private validateNodeSemantics(
    nodeType: NavigationNodeType,
    contentItemId?: string,
  ): void {
    // 节点类型和内容绑定关系必须在服务层收紧，否则树结构很容易退化成“什么都能挂”的脏模型。
    if (nodeType === NavigationNodeType.content && !contentItemId) {
      throw new BadRequestException('Content nodes require contentItemId');
    }
    if (nodeType === NavigationNodeType.subject && contentItemId) {
      throw new BadRequestException('Subject nodes cannot have contentItemId');
    }
  }

  private async assertNoCycle(
    id: string,
    nextParentId?: string,
  ): Promise<void> {
    // 更新父节点时沿祖先链向上检查，直接阻断自指和后代回挂，避免把整棵结构树写坏。
    let cursor = nextParentId;

    while (cursor) {
      if (cursor === id) {
        throw new BadRequestException(
          'Cannot move a node under itself or its descendant',
        );
      }

      const parent = await this.navigationRepository.findById(cursor);
      if (!parent) {
        throw new NotFoundException(
          `Parent navigation node ${cursor} not found`,
        );
      }
      cursor = parent.parentId?.toString();
    }
  }

  async createNavigationNode(
    dto: CreateNavigationNodeDto,
  ): Promise<NavigationNodeDto> {
    await this.getParentOrThrow(dto.parentId);
    this.validateNodeSemantics(dto.nodeType, dto.contentItemId);
    if (dto.contentItemId) {
      await this.contentService.assertContentItemExists(dto.contentItemId);
      // 一个 contentItemId 只能被一个导航节点引用，防止重复挂载
      const existing = await this.navigationRepository.findByContentItemId(dto.contentItemId);
      if (existing) {
        throw new BadRequestException('该内容项已被其他节点引用');
      }
    }

    // 同 parentId + scope 下不允许重名（FOLDER 和 DOC 共享命名空间）
    const scope = dto.scope ?? 'notes';
    const duplicate = await this.navigationRepository.findDuplicateName(
      dto.name,
      dto.parentId,
      scope,
    );
    if (duplicate) {
      throw new BadRequestException('同目录下已存在同名节点');
    }

    const entity = await this.navigationRepository.create(dto);
    return NavigationNodeDto.fromEntity(entity, false);
  }

  async updateNavigationNode(
    id: string,
    dto: UpdateNavigationNodeDto,
  ): Promise<NavigationNodeDto> {
    const current = await this.navigationRepository.findById(id);
    if (!current) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }

    const nextContentItemId =
      dto.contentItemId ?? current.contentItemId?.toString();

    if (dto.parentId !== undefined) {
      await this.assertNoCycle(id, dto.parentId);
      await this.getParentOrThrow(dto.parentId);
    }
    this.validateNodeSemantics(current.nodeType, nextContentItemId);
    if (nextContentItemId) {
      await this.contentService.assertContentItemExists(nextContentItemId);
      // contentItemId 变更时，检查新值是否已被其他节点引用
      if (dto.contentItemId && dto.contentItemId !== current.contentItemId?.toString()) {
        const existing = await this.navigationRepository.findByContentItemId(dto.contentItemId);
        if (existing && existing._id.toString() !== id) {
          throw new BadRequestException('该内容项已被其他节点引用');
        }
      }
    }

    // name 或 parentId 发生变更时，检查目标位置是否存在同名节点（排除自身）
    const nextName = dto.name ?? current.name;
    const nextParentId =
      dto.parentId !== undefined
        ? dto.parentId
        : current.parentId?.toString();
    const nextScope = (current.scope as string) ?? 'notes';
    if (dto.name !== undefined || dto.parentId !== undefined) {
      const duplicate = await this.navigationRepository.findDuplicateName(
        nextName,
        nextParentId,
        nextScope,
        id,
      );
      if (duplicate) {
        throw new BadRequestException('同目录下已存在同名节点');
      }
    }

    const entity = await this.navigationRepository.update(id, dto);
    if (!entity) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }
    return NavigationNodeDto.fromEntity(
      entity,
      await this.navigationRepository.hasChildren(entity._id.toString()),
    );
  }

  async listNodes(parentId?: string): Promise<NavigationNodeDto[]> {
    if (parentId) {
      await this.getParentOrThrow(parentId);
    }

    const entities = await this.navigationRepository.listByParentId(parentId);
    return this.toDtos(entities);
  }

  async findRootNodes(): Promise<NavigationNodeDto[]> {
    return this.listNodes();
  }

  async findChildrenByParentId(parentId: string): Promise<NavigationNodeDto[]> {
    return this.listNodes(parentId);
  }

  async findPathByNodeId(id: string): Promise<NavigationNodeDto[]> {
    const path: NavigationNode[] = [];
    let cursor = await this.navigationRepository.findById(id);

    if (!cursor) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }

    while (cursor) {
      path.push(cursor);
      cursor = cursor.parentId
        ? await this.navigationRepository.findById(cursor.parentId.toString())
        : null;
    }

    // 查询时从目标节点向上回溯最稳定，实现简单且不依赖额外的路径冗余字段。
    return this.toDtos(path.reverse());
  }

  async findPathByContentItemId(
    contentItemId: string,
  ): Promise<NavigationNodeDto[]> {
    const node =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!node) {
      throw new NotFoundException(
        `Navigation node for contentItem ${contentItemId} not found`,
      );
    }
    return this.findPathByNodeId(node._id.toString());
  }

  async getDeleteStats(id: string): Promise<DeleteStatsDto> {
    const node = await this.navigationRepository.findById(id);
    if (!node) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }

    const descendants = await this.navigationRepository.findAllDescendants(id);

    // 统计自身 + 后代
    const allNodes = [node, ...descendants];
    const stats = new DeleteStatsDto();
    stats.folderCount = allNodes.filter(
      (n) => n.nodeType === NavigationNodeType.subject,
    ).length;
    stats.docCount = allNodes.filter(
      (n) => n.nodeType === NavigationNodeType.content,
    ).length;
    return stats;
  }

  async deleteNavigationNodeById(id: string): Promise<void> {
    const node = await this.navigationRepository.findById(id);
    if (!node) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }

    // 级联删除：收集所有后代并一次性删除
    const descendants = await this.navigationRepository.findAllDescendants(id);
    const allIds = [id, ...descendants.map((d) => d._id.toString())];
    await this.navigationRepository.deleteManyByIds(allIds);
  }

  async createStructureNode(
    dto: CreateStructureNodeDto,
  ): Promise<StructureNodeDto> {
    let contentItemId = dto.contentItemId;

    // DOC 节点且调用方未提供 contentItemId 时，后端自动建 content item。
    // 这样前端只需发一个"新建 DOC 节点"请求，不再关心 content 的创建细节。
    // createContent 只建 MongoDB 记录（无 Git commit），内容通过后续 draft/commit 写入。
    if (dto.type === 'DOC' && !contentItemId) {
      const content = await this.contentService.createContent({
        title: dto.name,
      });
      contentItemId = content.id;
    }

    const created = await this.createNavigationNode(
      this.toCreateNavigationNodeDto({ ...dto, contentItemId }),
    );
    return {
      id: created.id,
      name: created.name,
      scope: (dto.scope as string) ?? 'notes',
      type: created.nodeType === NavigationNodeType.subject ? 'FOLDER' : 'DOC',
      parentId: created.parentId,
      contentItemId: created.contentItemId,
      sortOrder: created.order,
      hasChildren: created.hasChildren,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async updateStructureNode(
    id: string,
    dto: UpdateStructureNodeDto,
  ): Promise<StructureNodeDto> {
    const current = await this.navigationRepository.findById(id);
    if (!current) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }
    const nextType = dto.type
      ? this.toNavigationNodeType(dto.type)
      : current.nodeType;
    const updateDto = this.toUpdateNavigationNodeDto(dto);

    if (dto.type) {
      (
        updateDto as UpdateNavigationNodeDto & { nodeType?: NavigationNodeType }
      ).nodeType = nextType;
    }

    const nextContentItemId =
      updateDto.contentItemId ?? current.contentItemId?.toString();
    if (dto.parentId !== undefined) {
      await this.assertNoCycle(id, dto.parentId);
      await this.getParentOrThrow(dto.parentId);
    }
    this.validateNodeSemantics(nextType, nextContentItemId);
    if (nextContentItemId) {
      await this.contentService.assertContentItemExists(nextContentItemId);
      if (updateDto.contentItemId && updateDto.contentItemId !== current.contentItemId?.toString()) {
        const existing = await this.navigationRepository.findByContentItemId(updateDto.contentItemId);
        if (existing && existing._id.toString() !== id) {
          throw new BadRequestException('该内容项已被其他节点引用');
        }
      }
    }

    // name 或 parentId 发生变更时，检查目标位置是否存在同名节点（排除自身）
    const nextName = updateDto.name ?? current.name;
    const nextParentId =
      updateDto.parentId !== undefined
        ? updateDto.parentId
        : current.parentId?.toString();
    const nextScope = (current.scope as string) ?? 'notes';
    if (updateDto.name !== undefined || updateDto.parentId !== undefined) {
      const duplicate = await this.navigationRepository.findDuplicateName(
        nextName,
        nextParentId,
        nextScope,
        id,
      );
      if (duplicate) {
        throw new BadRequestException('同目录下已存在同名节点');
      }
    }

    const entity = await this.navigationRepository.update(
      id,
      updateDto as UpdateNavigationNodeDto & { nodeType?: NavigationNodeType },
    );
    if (!entity) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }
    return StructureNodeDto.fromEntity(
      entity,
      await this.navigationRepository.hasChildren(entity._id.toString()),
    );
  }

  async listStructureNodes(
    parentId?: string,
    visibility?: ContentVisibility,
    scope?: string,
  ): Promise<StructureListResultDto> {
    if (parentId) {
      await this.getParentOrThrow(parentId);
    }

    const entities = await this.navigationRepository.listByParentId(parentId, scope);
    const readableEntities = await this.filterReadableStructureNodes(
      entities,
      visibility,
    );
    const children = await this.toStructureDtos(readableEntities);

    // 有 parentId 时回溯祖先路径，根节点时 path 为空
    const path = parentId
      ? await this.findStructurePathByNodeId(parentId)
      : [];

    const result = new StructureListResultDto();
    result.path = path;
    result.children = children;
    return result;
  }

  async findStructurePathByNodeId(id: string): Promise<StructureNodeDto[]> {
    const path: NavigationNode[] = [];
    let cursor = await this.navigationRepository.findById(id);

    if (!cursor) {
      throw new NotFoundException(`NavigationNode ${id} not found`);
    }

    while (cursor) {
      path.push(cursor);
      cursor = cursor.parentId
        ? await this.navigationRepository.findById(cursor.parentId.toString())
        : null;
    }

    return this.toStructureDtos(path.reverse());
  }

  async reorderSiblings(dto: ReorderSiblingsDto): Promise<void> {
    if (dto.nodeIds.length === 0) return;

    /* Validate all nodes exist and belong to the same parent */
    const nodes = await Promise.all(
      dto.nodeIds.map((id) => this.navigationRepository.findById(id)),
    );

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) {
        throw new NotFoundException(
          `NavigationNode ${dto.nodeIds[i]} not found`,
        );
      }

      const nodeParentId = node.parentId?.toString() ?? null;
      const expectedParentId = dto.parentId ?? null;
      if (nodeParentId !== expectedParentId) {
        throw new BadRequestException(
          `Node ${dto.nodeIds[i]} does not belong to the specified parent`,
        );
      }
    }

    /* Assign sequential order values */
    const updates = dto.nodeIds.map((id, index) => ({
      id,
      order: index,
    }));

    await this.navigationRepository.bulkUpdateOrder(updates);
  }

  async findStructurePathByContentItemId(
    contentItemId: string,
  ): Promise<StructureNodeDto[]> {
    const node =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!node) {
      throw new NotFoundException(
        `Navigation node for contentItem ${contentItemId} not found`,
      );
    }
    return this.findStructurePathByNodeId(node._id.toString());
  }
}
