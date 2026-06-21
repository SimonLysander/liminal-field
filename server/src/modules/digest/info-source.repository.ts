/**
 * InfoSourceRepository — 信息源持久化层。
 *
 * 全局共用，无 scope 概念（不像 NavigationNode）。
 * 业务 id (src_xxx) 在 service 层生成，repository 只做存取。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import {
  InfoSource,
  FetchStatus,
  InfoSourceType,
  InfoSourceCategory,
} from './info-source.entity';
import { FetcherKind } from './fetchers/fetcher.interface';

export interface SaveInfoSourceInput {
  _id: string;
  type: InfoSourceType;
  /** Fetcher 插件 v2 抓取方式（必填）。 */
  fetcherKind: FetcherKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  /** 信息源分类（Task #42）。 */
  category: InfoSourceCategory;
  /** 一句话简介（Task #42），可选。 */
  description?: string;
}

export interface UpdateInfoSourceInput {
  type?: InfoSourceType;
  /** Fetcher 插件 v2 抓取方式更新（可选）。 */
  fetcherKind?: FetcherKind;
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  /** 更新分类（Task #42）。 */
  category?: InfoSourceCategory;
  /** 更新简介（Task #42）。 */
  description?: string;
}

export interface UpdateFetchStateInput {
  lastFetchedAt: Date;
  lastFetchStatus: FetchStatus;
  lastFetchError?: string;
}

@Injectable()
export class InfoSourceRepository {
  constructor(
    @Inject(getModelToken(InfoSource.name))
    private readonly infoSourceModel: ReturnModelType<typeof InfoSource>,
  ) {}

  async findById(id: string): Promise<InfoSource | null> {
    return this.infoSourceModel.findById(id).exec();
  }

  async findManyByIds(ids: string[]): Promise<InfoSource[]> {
    if (ids.length === 0) return [];
    return this.infoSourceModel.find({ _id: { $in: ids } }).exec();
  }

  /**
   * 查询全部信息源，支持按 category 过滤（Task #42）。
   * 不传 filter 或 filter.category 为 undefined 时返回全部。
   */
  async findAll(filter?: {
    category?: InfoSourceCategory;
  }): Promise<InfoSource[]> {
    const query: Record<string, unknown> = filter?.category
      ? { category: filter.category }
      : {};
    return this.infoSourceModel.find(query).sort({ createdAt: -1 }).exec();
  }

  /** 工作流扫描入口：列出所有启用的信息源（供调度/抓取作业筛取）。 */
  async findEnabled(): Promise<InfoSource[]> {
    return this.infoSourceModel.find({ enabled: true }).exec();
  }

  async create(input: SaveInfoSourceInput): Promise<InfoSource> {
    const now = new Date();
    const doc = await this.infoSourceModel.create({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    return doc;
  }

  async update(
    id: string,
    patch: UpdateInfoSourceInput,
  ): Promise<InfoSource | null> {
    return this.infoSourceModel
      .findByIdAndUpdate(id, { ...patch, updatedAt: new Date() }, { new: true })
      .exec();
  }

  /** 工作流抓取后回写状态（成功/失败 + 最后抓取时间），不动 enabled / config。 */
  async updateFetchState(
    id: string,
    state: UpdateFetchStateInput,
  ): Promise<void> {
    await this.infoSourceModel
      .updateOne(
        { _id: id },
        {
          lastFetchedAt: state.lastFetchedAt,
          lastFetchStatus: state.lastFetchStatus,
          lastFetchError: state.lastFetchError ?? null,
          updatedAt: new Date(),
        },
      )
      .exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.infoSourceModel.deleteOne({ _id: id }).exec();
  }
}
