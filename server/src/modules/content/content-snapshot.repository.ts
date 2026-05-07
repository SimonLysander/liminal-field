import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { ContentSnapshot } from './content-snapshot.entity';

@Injectable()
export class ContentSnapshotRepository {
  constructor(
    @Inject(getModelToken(ContentSnapshot.name))
    private readonly model: ReturnModelType<typeof ContentSnapshot>,
  ) {}

  async create(input: {
    versionId: string;
    contentItemId: string;
    title: string;
    summary: string;
    bodyMarkdown: string;
    assetRefs: string[];
    createdAt: Date;
    changeNote: string;
    commitHash?: string;
  }): Promise<ContentSnapshot> {
    return this.model.create({ _id: input.versionId, ...input });
  }

  /** 按 versionId 精确查找 */
  async findByVersionId(versionId: string): Promise<ContentSnapshot | null> {
    return this.model.findById(versionId);
  }

  /** 按 contentItemId 查询版本列表，最新在前 */
  async listByContentItemId(contentItemId: string): Promise<ContentSnapshot[]> {
    return this.model.find({ contentItemId }).sort({ createdAt: -1 });
  }

  /** 回填 Git commitHash */
  async backfillCommitHash(
    versionId: string,
    commitHash: string,
  ): Promise<void> {
    await this.model.findByIdAndUpdate(versionId, { $set: { commitHash } });
  }
}
