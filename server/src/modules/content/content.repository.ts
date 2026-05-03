import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import {
  ContentChangeLog,
  ContentItem,
  ContentVersion,
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

  async deleteById(id: string): Promise<void> {
    await this.contentItemModel.findByIdAndDelete(id);
  }
}
