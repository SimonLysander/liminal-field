import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isMongoDuplicateKeyError } from '../../common/mongo-errors';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NavigationNodeService } from '../navigation/navigation.service';
import { NavigationTopologyLockService } from '../navigation/navigation-topology-lock.service';
import { EditorDraftRepository } from '../workspace/editor-draft.repository';
import { LearningProjectRepository } from './learning-project.repository';
import type {
  LearningProjectDiscardDto,
  LearningProjectDto,
  LearningProjectResolveDto,
} from './dto/learning-project.dto';

@Injectable()
export class LearningProjectService {
  private readonly logger = new Logger(LearningProjectService.name);

  constructor(
    private readonly projectRepo: LearningProjectRepository,
    private readonly navigationRepo: NavigationRepository,
    private readonly navigationService: NavigationNodeService,
    private readonly editorDraftRepo: EditorDraftRepository,
    private readonly topologyLock: NavigationTopologyLockService,
  ) {}

  async resolveByNodeId(nodeId: string): Promise<LearningProjectResolveDto> {
    if (!nodeId?.trim()) {
      throw new BadRequestException('缺少 nodeId');
    }
    const path = await this.navigationService.findStructurePathByNodeId(nodeId);
    const currentNode = path.at(-1);
    if (!currentNode) {
      throw new NotFoundException(`NavigationNode ${nodeId} not found`);
    }

    const projectByRoot = new Map(
      (
        await this.projectRepo.findActiveByRootNodeIds(
          path.map((node) => node.id),
        )
      ).map((project) => [project.rootNodeId, project]),
    );
    const rootNode =
      [...path].reverse().find((node) => projectByRoot.has(node.id)) ??
      currentNode;
    const project = projectByRoot.get(rootNode.id) ?? null;

    this.logger.debug(
      `resolve learning nodeId=${nodeId} projectId=${project?.id ?? 'none'} rootNodeId=${rootNode.id}`,
    );

    return {
      project,
      canStart: !project,
      rootNode,
      currentNode,
      path,
    };
  }

  async resolveByContentItemId(
    contentItemId: string,
  ): Promise<LearningProjectResolveDto> {
    if (!contentItemId?.trim()) {
      throw new BadRequestException('缺少 contentItemId');
    }
    const path =
      await this.navigationService.findStructurePathByContentItemId(
        contentItemId,
      );
    const currentNode = path.at(-1);
    if (!currentNode) {
      throw new NotFoundException(
        `Navigation node for contentItem ${contentItemId} not found`,
      );
    }
    return this.resolveByNodeId(currentNode.id);
  }

  async startProject(rootNodeId: string): Promise<LearningProjectDto> {
    return this.topologyLock.runExclusive(() =>
      this.startProjectUnlocked(rootNodeId),
    );
  }

  /** 规划与正文共用页面的 AI 初稿槽位，必须以当前树上的最近学习根区分角色。 */
  async resolveWriteTarget(
    contentItemId: string,
    kind: 'plan' | 'draft',
  ): Promise<LearningProjectResolveDto> {
    const resolved = await this.resolveByContentItemId(contentItemId);
    const isRoot = resolved.currentNode.id === resolved.rootNode.id;
    if (!resolved.project || isRoot !== (kind === 'plan')) {
      this.logger.warn(
        `learning write target changed contentItemId=${contentItemId} kind=${kind} projectId=${resolved.project?.id ?? 'none'} rootNodeId=${resolved.rootNode.id}`,
      );
      throw new BadRequestException(
        '该页面的学习归属已变化，请重新进入学习后再操作',
      );
    }
    return resolved;
  }

  /** 校验与落库共享拓扑锁，防止审批期间移动或创建学习改变目标角色。 */
  async runWrite<T>(
    contentItemId: string,
    kind: 'plan' | 'draft',
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.topologyLock.runExclusive(async () => {
      await this.resolveWriteTarget(contentItemId, kind);
      return operation();
    });
  }

  private async startProjectUnlocked(
    rootNodeId: string,
  ): Promise<LearningProjectDto> {
    if (!rootNodeId?.trim()) {
      throw new BadRequestException('缺少 rootNodeId');
    }
    const path =
      await this.navigationService.findStructurePathByNodeId(rootNodeId);
    const rootNode = path.at(-1);
    if (!rootNode?.contentItemId) {
      throw new BadRequestException('学习根节点缺少 contentItemId');
    }

    const existing = await this.projectRepo.findActiveByRootNodeIds([
      rootNodeId,
    ]);
    if (existing.length > 0) {
      throw new BadRequestException('当前页面已开始学习');
    }

    this.logger.log(
      `start learning rootNodeId=${rootNodeId} rootContentItemId=${rootNode.contentItemId}`,
    );

    try {
      return await this.projectRepo.createActive({
        rootNodeId,
        rootContentItemId: rootNode.contentItemId,
      });
    } catch (err) {
      if (isMongoDuplicateKeyError(err)) {
        throw new BadRequestException('当前页面已开始学习');
      }
      throw err;
    }
  }

  /** 删除活动学习根会留下无法解析的项目，因此要求先显式放弃学习。 */
  async assertDeleteAllowed(nodeId: string): Promise<void> {
    const descendantIds =
      await this.navigationRepo.findAllDescendantIds(nodeId);
    const projects = await this.projectRepo.findActiveByRootNodeIds(
      uniqueStrings([nodeId, ...descendantIds]),
    );
    if (projects.length > 0) {
      throw new BadRequestException(
        '该节点范围内存在进行中的学习，请先放弃学习再删除',
      );
    }
  }

  async discardProject(projectId: string): Promise<LearningProjectDiscardDto> {
    return this.topologyLock.runExclusive(() =>
      this.discardProjectUnlocked(projectId),
    );
  }

  private async discardProjectUnlocked(
    projectId: string,
  ): Promise<LearningProjectDiscardDto> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundException(`LearningProject ${projectId} not found`);
    }
    if (project.status === 'archived') {
      return { affectedContentItemIds: [], deleted: 0 };
    }

    const descendants = await this.navigationRepo.findAllDescendants(
      project.rootNodeId,
    );
    const nestedProjects = await this.projectRepo.findActiveByRootNodeIds(
      descendants.map((node) => node._id.toString()),
    );
    const childrenByParent = new Map<string, string[]>();
    for (const node of descendants) {
      const parentId = node.parentId?.toString();
      if (!parentId) continue;
      const children = childrenByParent.get(parentId) ?? [];
      children.push(node._id.toString());
      childrenByParent.set(parentId, children);
    }
    // 独立子级学习根及其后代不属于当前项目的清理范围；不依赖查询返回顺序。
    const protectedIds = new Set<string>();
    const pending = nestedProjects.map((nested) => nested.rootNodeId);
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (protectedIds.has(id)) continue;
      protectedIds.add(id);
      pending.push(...(childrenByParent.get(id) ?? []));
    }
    const affectedContentItemIds = uniqueStrings([
      project.rootContentItemId,
      ...descendants
        .filter((node) => !protectedIds.has(node._id.toString()))
        .map((node) => node.contentItemId),
    ]);

    this.logger.log(
      `discard learning projectId=${projectId} rootNodeId=${project.rootNodeId} affected=${affectedContentItemIds.length} nestedProjects=${nestedProjects.length}`,
    );

    try {
      const deleted = await this.editorDraftRepo.deleteAiDraftsByContentItemIds(
        affectedContentItemIds,
      );
      await this.projectRepo.archive(projectId);
      return { affectedContentItemIds, deleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `discard learning failed projectId=${projectId} rootNodeId=${project.rootNodeId}: ${message}`,
        stack,
      );
      throw err;
    }
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}
