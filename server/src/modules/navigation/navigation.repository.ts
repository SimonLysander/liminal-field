import { Injectable, Inject } from '@nestjs/common';
import { getModelToken } from 'nestjs-typegoose';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import {
  NavigationNode,
  NavigationNodeType,
  NavigationScope,
} from './navigation.entity';

export interface CreateNavigationNode {
  name: string;
  scope?: string;
  parentId?: string;
  nodeType: NavigationNodeType;
  contentItemId?: string;
  order?: number;
}

// 仅在命名 & 结构上移动的更新
export interface UpdateNavigationNode {
  name?: string;
  parentId?: string;
  nodeType?: NavigationNodeType;
  contentItemId?: string;
  order?: number;
}

@Injectable()
export class NavigationRepository {
  constructor(
    @Inject(getModelToken('NavigationNode'))
    private readonly navigationModel: ReturnModelType<typeof NavigationNode>,
  ) {}

  async create(navigation: CreateNavigationNode): Promise<NavigationNode> {
    return this.navigationModel.create({
      name: navigation.name,
      scope: navigation.scope ?? NavigationScope.notes,
      parentId: navigation.parentId,
      nodeType: navigation.nodeType,
      contentItemId: navigation.contentItemId,
      order: navigation.order ?? 0,
      createdAt: new Date(),
      updatedAt: null,
    });
  }

  async findById(id: string): Promise<NavigationNode | null> {
    return this.navigationModel.findById(id);
  }

  /** scope 可选过滤：传入时只返回该 scope 下的节点 */
  async listByParentId(parentId?: string, scope?: string): Promise<NavigationNode[]> {
    const filter: Record<string, unknown> = { parentId: parentId ?? null };
    if (scope) filter.scope = scope;
    return this.navigationModel
      .find(filter)
      .sort({ order: 1, name: 1, _id: 1 });
  }

  async findRootNodes(scope?: string): Promise<NavigationNode[]> {
    return this.listByParentId(undefined, scope);
  }

  async findChildrenByParentId(parentId: string, scope?: string): Promise<NavigationNode[]> {
    return this.listByParentId(parentId, scope);
  }

  async countChildrenByParentIds(
    parentIds: string[],
    scope?: string,
  ): Promise<Record<string, number>> {
    if (parentIds.length === 0) return {};

    const match: Record<string, unknown> = {
      parentId: { $in: parentIds.map((id) => new Types.ObjectId(id)) },
    };
    if (scope) match.scope = scope;

    const rows = await this.navigationModel.aggregate<{
      _id: unknown;
      count: number;
    }>([
      { $match: match },
      { $group: { _id: '$parentId', count: { $sum: 1 } } },
    ]);

    return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
  }

  async hasChildren(parentId: string): Promise<boolean> {
    return (await this.navigationModel.countDocuments({ parentId })) > 0;
  }

  async findByContentItemId(
    contentItemId: string,
  ): Promise<NavigationNode | null> {
    return this.navigationModel.findOne({ contentItemId });
  }

  /**
   * 在同 parentId + scope 下查找是否已存在同名节点。
   * excludeId 用于更新时排除自身，避免把自己当成冲突节点。
   */
  async findDuplicateName(
    name: string,
    parentId: string | null | undefined,
    scope: string,
    excludeId?: string,
  ): Promise<NavigationNode | null> {
    const filter: Record<string, unknown> = {
      name,
      scope,
      parentId: parentId ?? null,
    };
    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }
    return this.navigationModel.findOne(filter);
  }

  async update(
    id: string,
    navigation: UpdateNavigationNode,
  ): Promise<NavigationNode | null> {
    return this.navigationModel.findByIdAndUpdate(
      id,
      {
        $set: {
          ...navigation,
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: 'after',
      },
    );
  }

  /** 批量更新 order：用 bulkWrite 替代多次独立 findByIdAndUpdate，减少 DB 往返并保证原子性 */
  async bulkUpdateOrder(
    updates: Array<{ id: string; order: number }>,
  ): Promise<void> {
    if (updates.length === 0) return;

    const now = new Date();
    await this.navigationModel.bulkWrite(
      updates.map((update) => ({
        updateOne: {
          filter: { _id: new Types.ObjectId(update.id) },
          update: { $set: { order: update.order, updatedAt: now } },
        },
      })),
    );
  }

  async findAllDescendants(rootId: string): Promise<NavigationNode[]> {
    const result: NavigationNode[] = [];
    const queue = [rootId];

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = await this.navigationModel.find({ parentId });
      for (const child of children) {
        result.push(child);
        queue.push(child._id.toString());
      }
    }

    return result;
  }

  async deleteById(id: string): Promise<void> {
    await this.navigationModel.findByIdAndDelete(id);
  }

  async deleteManyByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.navigationModel.deleteMany({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
  }
}
