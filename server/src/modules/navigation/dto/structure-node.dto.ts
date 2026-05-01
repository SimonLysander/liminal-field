import { NavigationNode, NavigationNodeType } from '../navigation.entity';

export type StructureNodeType = 'FOLDER' | 'DOC';

export class StructureNodeDto {
  id: string;
  name: string;
  type: StructureNodeType;
  scope: string;
  parentId?: string;
  contentItemId?: string;
  sortOrder: number;
  hasChildren: boolean;
  createdAt: Date;
  updatedAt?: Date;

  static fromEntity(
    entity: NavigationNode,
    hasChildren = false,
  ): StructureNodeDto {
    const dto = new StructureNodeDto();
    dto.id = entity._id.toString();
    dto.name = entity.name;
    dto.scope = entity.scope ?? 'notes';
    dto.type =
      entity.nodeType === NavigationNodeType.subject ? 'FOLDER' : 'DOC';
    dto.parentId = entity.parentId?.toString();
    dto.contentItemId = entity.contentItemId?.toString();
    dto.sortOrder = entity.order ?? 0;
    dto.hasChildren = hasChildren;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt ?? undefined;
    return dto;
  }
}

export class StructureListResultDto {
  path: StructureNodeDto[];
  children: StructureNodeDto[];
}

export class DeleteStatsDto {
  folderCount: number;
  docCount: number;
}
