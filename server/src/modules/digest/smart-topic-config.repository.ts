/**
 * SmartTopicConfigRepository — 智能采集事项配置持久化层。
 *
 * 跟事项容器（digest scope 根节点的 ContentItem）一对一。
 * 业务 id (stc_xxx) 在 service 层生成。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { SmartTopicConfig, RunStatus } from './smart-topic-config.entity';

export interface SaveSmartTopicConfigInput {
  _id: string;
  contentItemId: string;
  cron: string;
  sourceIds: string[];
  keywords: string[];
  prompt: string;
  enabled: boolean;
  /** 可选：不传时由 schema default(20) 兜底 */
  maxSteps?: number;
}

export interface UpdateSmartTopicConfigInput {
  cron?: string;
  sourceIds?: string[];
  keywords?: string[];
  prompt?: string;
  enabled?: boolean;
  maxSteps?: number;
}

export interface UpdateRunStateInput {
  lastRunAt: Date;
  lastRunStatus: RunStatus;
  lastRunError?: string;
}

@Injectable()
export class SmartTopicConfigRepository {
  constructor(
    @Inject(getModelToken(SmartTopicConfig.name))
    private readonly smartTopicConfigModel: ReturnModelType<
      typeof SmartTopicConfig
    >,
  ) {}

  async findById(id: string): Promise<SmartTopicConfig | null> {
    return this.smartTopicConfigModel.findById(id).exec();
  }

  /** 按事项容器 ContentItem.id 反查配置 — 编辑事项时读这个。 */
  async findByContentItemId(
    contentItemId: string,
  ): Promise<SmartTopicConfig | null> {
    return this.smartTopicConfigModel.findOne({ contentItemId }).exec();
  }

  async findAll(): Promise<SmartTopicConfig[]> {
    return this.smartTopicConfigModel.find().sort({ createdAt: -1 }).exec();
  }

  /** 调度入口：列所有启用的事项，按 cron 扫描分发。 */
  async findEnabled(): Promise<SmartTopicConfig[]> {
    return this.smartTopicConfigModel.find({ enabled: true }).exec();
  }

  async create(input: SaveSmartTopicConfigInput): Promise<SmartTopicConfig> {
    const now = new Date();
    const doc = await this.smartTopicConfigModel.create({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    return doc;
  }

  async update(
    id: string,
    patch: UpdateSmartTopicConfigInput,
  ): Promise<SmartTopicConfig | null> {
    return this.smartTopicConfigModel
      .findByIdAndUpdate(id, { ...patch, updatedAt: new Date() }, { new: true })
      .exec();
  }

  /** 工作流跑完后回写状态 — 不动 cron / sourceIds / keywords / prompt / enabled。 */
  async updateRunState(id: string, state: UpdateRunStateInput): Promise<void> {
    await this.smartTopicConfigModel
      .updateOne(
        { _id: id },
        {
          lastRunAt: state.lastRunAt,
          lastRunStatus: state.lastRunStatus,
          lastRunError: state.lastRunError ?? null,
          updatedAt: new Date(),
        },
      )
      .exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.smartTopicConfigModel.deleteOne({ _id: id }).exec();
  }

  async deleteByContentItemId(contentItemId: string): Promise<void> {
    await this.smartTopicConfigModel.deleteOne({ contentItemId }).exec();
  }
}
