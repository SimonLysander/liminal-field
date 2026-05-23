import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import {
  ContentChangeLog,
  ContentItem,
  ContentVersion,
  EntryPublishState,
} from './content-item.entity';

export interface CreateContentItemInput {
  id: string;
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  changeLogs: ContentChangeLog[];
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface UpdateContentItemInput {
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  changeLogs: ContentChangeLog[];
  updatedAt: Date;
  updatedBy?: string;
}

@Injectable()
export class ContentRepository {
  constructor(
    @Inject(getModelToken(ContentItem.name))
    private readonly contentItemModel: ReturnModelType<typeof ContentItem>,
  ) {}

  async create(input: CreateContentItemInput): Promise<ContentItem> {
    return this.contentItemModel.create({
      _id: input.id,
      latestVersion: input.latestVersion,
      publishedVersion: input.publishedVersion ?? null,
      changeLogs: input.changeLogs,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      createdBy: input.createdBy,
      updatedBy: input.updatedBy,
    });
  }

  async findById(id: string): Promise<ContentItem | null> {
    return this.contentItemModel.findById(id);
  }

  async update(
    id: string,
    input: UpdateContentItemInput,
  ): Promise<ContentItem | null> {
    return this.contentItemModel.findByIdAndUpdate(
      id,
      {
        $set: {
          latestVersion: input.latestVersion,
          publishedVersion: input.publishedVersion ?? null,
          changeLogs: input.changeLogs,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * 设置文集条目级发布状态(只 $set entryPublishStates,不触碰其它字段)。
   * 独立方法而非走 update():update() 会重写 publishedVersion 等,语义不符;
   * 且发布/取消发布只该动这一个字段。
   */
  async setEntryPublishStates(
    id: string,
    states: EntryPublishState[],
  ): Promise<void> {
    await this.contentItemModel.findByIdAndUpdate(id, {
      $set: { entryPublishStates: states },
    });
  }

  async list(options?: {
    page?: number;
    pageSize?: number;
  }): Promise<ContentItem[]> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    return this.contentItemModel
      .find({})
      .sort({ updatedAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
  }

  async listAll(): Promise<ContentItem[]> {
    return this.contentItemModel.find({}).sort({ updatedAt: -1, _id: 1 });
  }

  /** 按标题/摘要关键字搜索（MongoDB $regex 下推，避免全量加载到内存） */
  async searchByKeyword(
    keyword: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<ContentItem[]> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    return this.contentItemModel
      .find({
        $or: [
          { 'latestVersion.title': regex },
          { 'latestVersion.summary': regex },
          { 'publishedVersion.title': regex },
          { 'publishedVersion.summary': regex },
        ],
      })
      .sort({ updatedAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
  }

  /** 轻量更新 latestVersion 的元数据字段（title/summary），不创建新快照。 */
  async patchMeta(
    id: string,
    fields: { title?: string; summary?: string },
  ): Promise<ContentItem | null> {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.title !== undefined)
      $set['latestVersion.title'] = fields.title;
    if (fields.summary !== undefined)
      $set['latestVersion.summary'] = fields.summary;
    return this.contentItemModel.findByIdAndUpdate(
      id,
      { $set },
      { returnDocument: 'after' },
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.contentItemModel.findByIdAndDelete(id);
  }

  /** 清空全部 ContentItem（灾难恢复 / 远端同步前清空用） */
  async deleteAll(): Promise<number> {
    const result = await this.contentItemModel.deleteMany({});
    return result.deletedCount ?? 0;
  }

  /** 全部内容总数 */
  async countAll(): Promise<number> {
    return this.contentItemModel.countDocuments({});
  }

  /** 已发布内容总数（MongoDB countDocuments，不加载文档到内存）。 */
  async countPublished(): Promise<number> {
    return this.contentItemModel.countDocuments({
      publishedVersion: { $ne: null },
    });
  }
}
