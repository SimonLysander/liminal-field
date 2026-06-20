/**
 * ProcessedFeedItemRepository — 已处理条目持久化层。
 *
 * 核心能力：
 *   - existsByTopicAndGuid()：去重检查，工作流 commit 前判断是否已推
 *   - findRecentByTopic()：查最近 N 天命中条目，供 get_recent_picks 工具使用
 *   - create()：commit 节点写入命中记录
 *
 * id 生成在调用方（commit 节点），repository 只做存取。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { ProcessedFeedItem } from './processed-feed-item.entity';

export interface CreateProcessedFeedItemInput {
  _id: string;
  topicId: string;
  sourceId: string;
  itemGuid: string;
  title: string;
  url: string;
  pickedAt: Date;
  reportContentItemId: string;
}

@Injectable()
export class ProcessedFeedItemRepository {
  constructor(
    @Inject(getModelToken(ProcessedFeedItem.name))
    private readonly model: ReturnModelType<typeof ProcessedFeedItem>,
  ) {}

  /** 去重：该事项内 itemGuid 是否已被推送过 */
  async existsByTopicAndGuid(
    topicId: string,
    itemGuid: string,
  ): Promise<boolean> {
    const count = await this.model.countDocuments({ topicId, itemGuid }).exec();
    return count > 0;
  }

  /**
   * 查某事项最近 N 天的命中条目，按 pickedAt 倒序，供 get_recent_picks 工具使用。
   * days 默认 30，limit 默认 50（工具层按需覆盖）。
   */
  async findRecentByTopic(
    topicId: string,
    days = 30,
    limit = 50,
  ): Promise<ProcessedFeedItem[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.model
      .find({ topicId, pickedAt: { $gte: since } })
      .sort({ pickedAt: -1 })
      .limit(limit)
      .exec();
  }

  /** 写入一条命中记录（commit 节点调用） */
  async create(
    input: CreateProcessedFeedItemInput,
  ): Promise<ProcessedFeedItem> {
    return this.model.create(input);
  }

  /** 按 id 查询（测试辅助 / 调试用） */
  async findById(id: string): Promise<ProcessedFeedItem | null> {
    return this.model.findById(id).exec();
  }

  /** 批量检查：返回已存在的 (topicId, itemGuid) 组合，供批量去重 */
  async findExistingGuids(
    topicId: string,
    itemGuids: string[],
  ): Promise<string[]> {
    if (itemGuids.length === 0) return [];
    const docs = await this.model
      .find({ topicId, itemGuid: { $in: itemGuids } }, { itemGuid: 1 })
      .exec();
    return docs.map((d) => d.itemGuid);
  }
}
