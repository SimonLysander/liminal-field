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

  /**
   * 按 bodyMarkdown 关键字搜索，返回匹配的 contentItemId 列表（去重）。
   * 仅搜索每个 content 的最新 snapshot，避免全量扫描。
   */
  async searchContentIdsByBodyKeyword(
    keyword: string,
    limit = 20,
  ): Promise<string[]> {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const results = await this.model.aggregate<{ _id: string }>([
      // 按 contentItemId 分组取最新 snapshot
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$contentItemId',
          bodyMarkdown: { $first: '$bodyMarkdown' },
        },
      },
      { $match: { bodyMarkdown: { $regex: escaped, $options: 'i' } } },
      { $limit: limit },
    ]);
    return results.map((r) => r._id);
  }

  /** 回填 Git commitHash */
  async backfillCommitHash(
    versionId: string,
    commitHash: string,
  ): Promise<void> {
    await this.model.findByIdAndUpdate(versionId, { $set: { commitHash } });
  }

  /**
   * 查询 commitHash 尚未回填的 snapshot（Git 归档失败待重试）。
   * 排除 bodyMarkdown 为空的初始 snapshot（createContent 产生，无需 Git commit）。
   */
  async findPendingArchive(limit = 20): Promise<ContentSnapshot[]> {
    return this.model
      .find({
        $or: [{ commitHash: { $exists: false } }, { commitHash: '' }],
        bodyMarkdown: { $ne: '' },
      })
      .sort({ createdAt: 1 })
      .limit(limit);
  }
}
