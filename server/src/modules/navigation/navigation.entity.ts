import { index, modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

/**
 * 业务模块隔离标识。NavigationNode 通过 scope 区分属于哪个业务模块，
 * 使同一张 navigation_nodes 表可以为 notes、gallery 等不同模块提供独立的树形索引。
 * 新增业务模块只需在此枚举追加值。
 */
export enum NavigationScope {
  notes = 'notes',
  gallery = 'gallery',
  anthology = 'anthology',
}

// 覆盖 listByParentId 和 findRootNodes 的查询+排序：{ parentId, scope, order }
@index({ parentId: 1, scope: 1, order: 1 })
@modelOptions({
  schemaOptions: { collection: 'navigation_nodes' },
  options: { allowMixed: Severity.ERROR },
})
export class NavigationNode {
  // Navigation nodes are still native Mongo documents, so their own identity remains ObjectId.
  readonly _id!: Types.ObjectId;

  @prop({ required: true, trim: true })
  public name!: string;

  /** 业务模块隔离：决定该节点属于 notes 还是 gallery 等 scope */
  @prop({
    enum: NavigationScope,
    required: true,
    default: NavigationScope.notes,
    index: true,
  })
  public scope!: NavigationScope;

  @prop({ type: Types.ObjectId })
  public parentId?: Types.ObjectId;

  // 节点同质化(2026-05-29):不再有 subject/content 二分,每个节点都挂一个 ContentItem
  // (正文可空),"容器" = 有子节点(以它为 parentId)的节点,运行时算出,不靠类型字段。
  // Content items use business string IDs like ci_xxx；unique 保证一个 ContentItem 只挂一个节点。
  @prop({ required: true, trim: true, unique: true })
  public contentItemId!: string;

  @prop({ required: true, default: 0 })
  public order!: number;

  @prop()
  public createdAt!: Date;

  @prop({ type: Date })
  public updatedAt!: Date | null;
}
