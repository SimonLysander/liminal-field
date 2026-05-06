import { modelOptions, prop, Severity } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export enum NavigationNodeType {
  subject = 'subject',
  content = 'content',
}

/**
 * 业务模块隔离标识。NavigationNode 通过 scope 区分属于哪个业务模块，
 * 使同一张 navigation_nodes 表可以为 notes、gallery 等不同模块提供独立的树形索引。
 * 新增业务模块只需在此枚举追加值。
 */
export enum NavigationScope {
  notes = 'notes',
  gallery = 'gallery',
}

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

  @prop({ enum: NavigationNodeType, required: true })
  public nodeType!: NavigationNodeType;

  // Content items use business string IDs like ci_xxx. Navigation only references that ID,
  // so forcing ObjectId casting here breaks DOC-node creation and mixes two different ID systems.
  // sparse unique: 只对非 null 值生效，FOLDER 节点无 contentItemId 不受约束
  @prop({ trim: true, unique: true, sparse: true })
  public contentItemId?: string;

  @prop({ required: true, default: 0 })
  public order!: number;

  @prop()
  public createdAt!: Date;

  @prop({ type: Date })
  public updatedAt!: Date | null;
}
