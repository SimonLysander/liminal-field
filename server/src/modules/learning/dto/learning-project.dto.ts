import type { StructureNodeDto } from '../../navigation/dto/structure-node.dto';
import type { LearningProjectStatus } from '../learning-project.entity';

export interface LearningProjectDto {
  id: string;
  rootNodeId: string;
  rootContentItemId: string;
  status: LearningProjectStatus;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface LearningProjectResolveDto {
  project: LearningProjectDto | null;
  canStart: boolean;
  rootNode: StructureNodeDto;
  currentNode: StructureNodeDto;
  path: StructureNodeDto[];
}

export interface LearningProjectDiscardDto {
  affectedContentItemIds: string[];
  deleted: number;
}
