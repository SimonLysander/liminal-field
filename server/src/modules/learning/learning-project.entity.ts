import { index, modelOptions, prop } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export type LearningProjectStatus = 'active' | 'archived';

@index(
  { rootNodeId: 1 },
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
