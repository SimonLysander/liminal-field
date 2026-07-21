import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { WriteFenceCounter } from './write-fence-counter.entity';

@Injectable()
export class WriteFenceCounterRepository {
  constructor(
    @Inject(getModelToken(WriteFenceCounter.name))
    private readonly model: ReturnModelType<typeof WriteFenceCounter>,
  ) {}

  /** Mongo 原子 $inc 分配目标内严格递增的写序号。 */
  async next(targetKey: string): Promise<number> {
    const counter = await this.model.findOneAndUpdate(
      { _id: targetKey },
      { $inc: { sequence: 1 } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    if (!counter) {
      throw new InternalServerErrorException(
        `Failed to allocate write fence for ${targetKey}`,
      );
    }
    return counter.sequence;
  }
}
