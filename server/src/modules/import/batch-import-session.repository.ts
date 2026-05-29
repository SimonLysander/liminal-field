import { Inject, Injectable } from '@nestjs/common';
import { getModelToken } from 'nestjs-typegoose';
import type { ReturnModelType } from '@typegoose/typegoose';
import {
  BatchImportSession,
  type BatchImportItem,
} from './batch-import-session.entity';

@Injectable()
export class BatchImportSessionRepository {
  constructor(
    @Inject(getModelToken(BatchImportSession.name))
    private readonly model: ReturnModelType<typeof BatchImportSession>,
  ) {}

  async create(data: {
    id: string;
    // parentId 可选，undefined 表示导入到 scope 根目录
    parentId?: string;
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
