import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { isMongoDuplicateKeyError } from '../../../common/mongo-errors';
import {
  AgentMemoryObservation,
  AgentMemoryCurrentView,
  CURRENT_VIEW_SINGLETON_ID,
  type ObservationTopic,
} from './agent-memory-observation.entity';

/**
 * AgentMemoryObservationRepository — 岁月史书的 CRUD,但**只有 C**(Create + Read)。
 *
 * 设计约束(写在代码里防回归):
 * - **无 update**:本类不提供任何修改 observation 字段的方法
 * - **无 delete**:本类不提供 deleteByXxx / deleteOne / deleteMany
 * - 真要删/清,只有 SRE/DBA 直接连 mongo;代码层不开口
 *
 * View 是派生数据,允许 upsert(它本质是缓存,可重建)。
 */
@Injectable()
export class AgentMemoryObservationRepository {
  private readonly logger = new Logger(AgentMemoryObservationRepository.name);

  constructor(
    @Inject(getModelToken(AgentMemoryObservation.name))
    private readonly observationModel: ReturnModelType<
      typeof AgentMemoryObservation
    >,
    @Inject(getModelToken(AgentMemoryCurrentView.name))
    private readonly viewModel: ReturnModelType<typeof AgentMemoryCurrentView>,
  ) {}

  // ─── Observations(append-only) ───────────────────────────────

  /** 批量 append observations(observer LLM 决策后一次写入) */
  async appendMany(
    items: Array<{
      observedAt?: Date;
      topic: ObservationTopic;
      observation: string;
      context?: string;
      sessionKey?: string;
    }>,
  ): Promise<AgentMemoryObservation[]> {
    if (items.length === 0) return [];
    const now = new Date();
    const docs = items.map((i) => ({
      observedAt: i.observedAt ?? now,
      topic: i.topic,
      observation: i.observation,
      context: i.context,
      sessionKey: i.sessionKey,
    }));
    const created = await this.observationModel.insertMany(docs);
    this.logger.debug(
      `appendMany: 写入 ${created.length} 条 observations(topics=${[...new Set(items.map((i) => i.topic))].join(',')})`,
    );
    return created;
  }

  /**
   * 审批提交专用的幂等追加。进程在“写入完成、审批落状态”之间退出时，
   * 下一次重放会命中同一组 idempotencyKey，而不会重复写入史书事件。
   */
  async appendManyIdempotent(
    writeId: string,
    items: Array<{
      observedAt?: Date;
      topic: ObservationTopic;
      observation: string;
      context?: string;
      sessionKey?: string;
    }>,
  ): Promise<void> {
    if (items.length === 0) return;
    const now = new Date();
    for (const [index, item] of items.entries()) {
      const idempotencyKey = `${writeId}:${index}`;
      try {
        await this.observationModel.updateOne(
          { idempotencyKey },
          {
            $setOnInsert: {
              observedAt: item.observedAt ?? now,
              topic: item.topic,
              observation: item.observation,
              context: item.context,
              sessionKey: item.sessionKey,
              idempotencyKey,
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if (!isMongoDuplicateKeyError(error)) throw error;

        // 并发 upsert 的唯一键冲突表示另一执行者已写入；重查确认后按幂等成功处理。
        const exists = await this.observationModel.exists({ idempotencyKey });
        if (!exists) throw error;
      }
    }
    this.logger.debug(
      `appendManyIdempotent: writeId=${writeId} observations=${items.length}`,
    );
  }

  /** 取最近 N 条(派生 prompt + observer 喂"已观察过的"防重复都用) */
  async findRecent(limit = 100): Promise<AgentMemoryObservation[]> {
    return this.observationModel
      .find()
      .sort({ observedAt: -1 })
      .limit(limit)
      .lean<AgentMemoryObservation[]>()
      .exec();
  }

  /** 按 topic 取最近 N 条(recall_memory / search_memories 按主题过滤用) */
  async findRecentByTopic(
    topic: ObservationTopic,
    limit = 50,
  ): Promise<AgentMemoryObservation[]> {
    return this.observationModel
      .find({ topic })
      .sort({ observedAt: -1 })
      .limit(limit)
      .lean<AgentMemoryObservation[]>()
      .exec();
  }

  /** 总数(view 派生用脏检测) */
  async count(): Promise<number> {
    return this.observationModel.countDocuments();
  }

  /** 取全量(迁移/导出用,慎用) */
  async findAll(): Promise<AgentMemoryObservation[]> {
    return this.observationModel
      .find()
      .sort({ observedAt: -1 })
      .lean<AgentMemoryObservation[]>()
      .exec();
  }

  // ─── Current View(派生,允许 upsert) ──────────────────────────

  /** 读当前画像 */
  async findCurrentView(): Promise<AgentMemoryCurrentView | null> {
    return this.viewModel.findById(CURRENT_VIEW_SINGLETON_ID).lean();
  }

  /** upsert 当前画像(observer 派生完成后写入) */
  async upsertCurrentView(params: {
    markdown: string;
    observationCount: number;
  }): Promise<AgentMemoryCurrentView> {
    const now = new Date();
    const result = await this.viewModel.findOneAndUpdate(
      { _id: CURRENT_VIEW_SINGLETON_ID },
      {
        $set: {
          markdown: params.markdown,
          derivedAt: now,
          observationCount: params.observationCount,
        },
      },
      { upsert: true, new: true },
    );
    return result;
  }
}
