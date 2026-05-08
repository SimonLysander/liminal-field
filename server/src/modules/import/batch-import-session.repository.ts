import { Injectable } from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import {
  BatchImportSession,
  type BatchImportItem,
} from './batch-import-session.entity';

@Injectable()
export class BatchImportSessionRepository {
  constructor(
    @InjectModel(BatchImportSession)
    private readonly model: ReturnModelType<typeof BatchImportSession>,
  ) {}

  async create(data: {
    id: string;
    parentId: string;
    items: BatchImportItem[];
  }): Promise<BatchImportSession> {
    const now = new Date();
    return this.model.create({
      _id: data.id,
      parentId: data.parentId,
      items: data.items,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    });
  }

  async findById(id: string): Promise<BatchImportSession | null> {
    return this.model.findById(id).lean();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id });
  }
}
