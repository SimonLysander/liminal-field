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
    let startBlockedReason: LearningProjectResolveDto['startBlockedReason'] =
      null;

    if (!project) {
      // 当前节点不属于任何项目时，仍要检查下级项目；否则页面会允许点击，
      // 最终却被 startProject 的父子互斥校验拒绝。
      const descendantNodeIds =
        await this.navigationRepo.findAllDescendantIds(nodeId);
      const descendantProjects =
        await this.projectRepo.findActiveByRootNodeIds(descendantNodeIds);
      if (descendantProjects.length > 0) {
        startBlockedReason = 'descendant-project';
      }
    }

    this.logger.debug(
      `resolve learning nodeId=${nodeId} projectId=${project?.id ?? 'none'} rootNodeId=${rootNode.id} startBlockedReason=${startBlockedReason ?? 'none'}`,
    );

    return {
      project,
      canStart: !project && !startBlockedReason,
      startBlockedReason,
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

    const descendants =
      await this.navigationRepo.findAllDescendants(rootNodeId);
    const descendantNodeIds = descendants.map((node) => node._id.toString());

    // 父子项目必须互斥：祖先路径用于发现已有的上级项目，后代用于发现已有的下级项目。
    const overlapCandidateRootNodeIds = uniqueStrings([
      ...path.map((node) => node.id),
      ...descendantNodeIds,
    ]);
    const overlaps = await this.projectRepo.findActiveByRootNodeIds(
      overlapCandidateRootNodeIds,
    );
    if (overlaps.length > 0) {
      throw new BadRequestException('当前节点已与一个学习项目范围重叠');
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
        throw new BadRequestException('当前节点已与一个学习项目范围重叠');
      }
      throw err;
    }
  }

  /**
   * 普通节点可以在学习项目之间自由移动；只有移动子树本身包含活动项目根，
   * 且目标位置已经属于另一个活动项目时，移动才会制造真实的父子项目重叠。
   */
  async assertMoveAllowed(
    nodeId: string,
    targetParentId?: string | null,
  ): Promise<void> {
    if (!targetParentId) return;

    const movingDescendantIds =
      await this.navigationRepo.findAllDescendantIds(nodeId);
    const movingProjectRoots = await this.projectRepo.findActiveByRootNodeIds(
      uniqueStrings([nodeId, ...movingDescendantIds]),
    );
    if (movingProjectRoots.length === 0) return;

    const targetPath =
      await this.navigationService.findStructurePathByNodeId(targetParentId);
    const targetProjects = await this.projectRepo.findActiveByRootNodeIds(
      targetPath.map((node) => node.id),
    );
    const movingProjectIds = new Set(
      movingProjectRoots.map((project) => project.id),
    );
    if (targetProjects.some((project) => !movingProjectIds.has(project.id))) {
      throw new BadRequestException(
        '移动后会使两个进行中的学习项目范围重叠，请先放弃其中一个学习项目',
      );
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
    const affectedContentItemIds = uniqueStrings([
      project.rootContentItemId,
      ...descendants.map((node) => node.contentItemId).filter(Boolean),
    ]);

    this.logger.log(
      `discard learning projectId=${projectId} rootNodeId=${project.rootNodeId} affected=${affectedContentItemIds.length}`,
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
