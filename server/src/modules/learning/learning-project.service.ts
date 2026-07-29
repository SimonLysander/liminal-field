import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isMongoDuplicateKeyError } from '../../common/mongo-errors';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NavigationNodeService } from '../navigation/navigation.service';
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

    // 持久化范围只能包含当前子树。若把祖先写入唯一多键索引，兄弟项目会因共享父节点而误判重叠。
    const scopeNodeIds = uniqueStrings([rootNodeId, ...descendantNodeIds]);

    this.logger.log(
      `start learning rootNodeId=${rootNodeId} rootContentItemId=${rootNode.contentItemId}`,
    );

    try {
      return await this.projectRepo.createActive({
        rootNodeId,
        rootContentItemId: rootNode.contentItemId,
        scopeNodeIds,
      });
    } catch (err) {
      if (isMongoDuplicateKeyError(err)) {
        throw new BadRequestException('当前节点已与一个学习项目范围重叠');
      }
      throw err;
    }
  }

  async discardProject(projectId: string): Promise<LearningProjectDiscardDto> {
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
