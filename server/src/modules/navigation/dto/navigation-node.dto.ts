import { NavigationNode, NavigationNodeType } from '../navigation.entity';

export class NavigationNodeDto {
  id: string;
  name: string;
  nodeType: NavigationNodeType;
  parentId?: string;
  contentItemId?: string;
  order: number;
  hasChildren: boolean;
  createdAt: Date;
  updatedAt?: Date;

  static fromEntity(
    entity: NavigationNode,
    hasChildren = false,
  ): NavigationNodeDto {
    const dto = new NavigationNodeDto();
    dto.id = entity._id.toString();
    dto.name = entity.name;
    dto.nodeType = entity.nodeType;
    dto.parentId = entity.parentId?.toString();
    dto.contentItemId = entity.contentItemId?.toString();
    dto.order = entity.order ?? 0;
    dto.hasChildren = hasChildren;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt ?? undefined;
    return dto;
  }
}
