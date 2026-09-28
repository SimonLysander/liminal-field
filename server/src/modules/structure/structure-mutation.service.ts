import { Injectable } from '@nestjs/common';
import { LearningProjectService } from '../learning/learning-project.service';
import type { StructureNodeDto } from '../navigation/dto/structure-node.dto';
import type { UpdateStructureNodeDto } from '../navigation/dto/update-structure-node.dto';
import { NavigationNodeService } from '../navigation/navigation.service';
import { NavigationTopologyLockService } from '../navigation/navigation-topology-lock.service';

/** 编排导航写入及其学习项目约束，避免底层导航模块反向依赖学习模块。 */
@Injectable()
export class StructureMutationService {
  constructor(
    private readonly navigationService: NavigationNodeService,
    private readonly learningProjectService: LearningProjectService,
    private readonly topologyLock: NavigationTopologyLockService,
  ) {}

  async updateStructureNode(
    id: string,
    dto: UpdateStructureNodeDto,
  ): Promise<StructureNodeDto> {
    if (dto.parentId === undefined) {
      return this.navigationService.updateStructureNode(id, dto);
    }

    return this.topologyLock.runExclusive(() =>
      this.navigationService.updateStructureNode(id, dto),
    );
  }

  async deleteStructureNode(id: string): Promise<void> {
    await this.topologyLock.runExclusive(async () => {
      await this.learningProjectService.assertDeleteAllowed(id);
      await this.navigationService.deleteNavigationNodeById(id);
    });
  }
}
