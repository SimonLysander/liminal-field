import { modelOptions, prop } from '@typegoose/typegoose';

/** 每个可写目标一条原子计数器，为审批与直接写提供严格单调顺序。 */
@modelOptions({
  schemaOptions: { collection: 'write_fence_counters', timestamps: false },
})
export class WriteFenceCounter {
  @prop({ required: true, type: () => String })
  _id!: string;

  @prop({ required: true, type: () => Number, default: 0 })
  sequence!: number;
}
