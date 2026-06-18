/**
 * InfoSourceRepository — 信息源持久化层。
 *
 * 全局共用，无 scope 概念（不像 NavigationNode）。
 * 业务 id (src_xxx) 在 service 层生成，repository 只做存取。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { InfoSource, FetchStatus, InfoSourceType } from './info-source.entity';

export interface SaveInfoSourceInput {
  _id: string;
  type: InfoSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface UpdateInfoSourceInput {
  type?: InfoSourceType;
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
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

  async findAll(): Promise<InfoSource[]> {
    return this.infoSourceModel.find().sort({ createdAt: -1 }).exec();
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
