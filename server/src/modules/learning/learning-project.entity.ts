import { index, modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export type LearningProjectStatus = 'active' | 'archived';

@index(
  { rootNodeId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)
@index(
  { scopeNodeIds: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)
@modelOptions({
  schemaOptions: { collection: 'learning_projects' },
})
export class LearningProject {
  readonly _id!: Types.ObjectId;

  @prop({ required: true, trim: true })
  rootNodeId!: string;

  @prop({ required: true, trim: true })
  rootContentItemId!: string;

  /**
   * 这个学习项目覆盖的 root + 全部后代节点。
   * active 状态下对数组建唯一索引，确保父/子学习项目并发创建时也由 Mongo 原子拦截。
   */
  @prop({ required: true, type: () => [String], default: [] })
  scopeNodeIds!: string[];

  @prop({
    required: true,
    enum: ['active', 'archived'],
    type: () => String,
    index: true,
  })
  status!: LearningProjectStatus;

  @prop({ required: true, type: () => Date })
  createdAt!: Date;

  @prop({ required: true, type: () => Date })
  updatedAt!: Date;

  @prop({ type: () => Date })
  archivedAt?: Date;
}
