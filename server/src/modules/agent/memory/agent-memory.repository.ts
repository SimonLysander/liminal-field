import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { getModelToken } from 'nestjs-typegoose';
import { AgentMemory, type AgentMemoryType } from './agent-memory.entity';

/**
 * AgentMemoryRepository — 记忆的 CRUD 操作层。
 *
 * 所有写入由 MemoryAgentService 调用，不直接暴露给工具。
 * title 是唯一索引，upsert by title。
 */
@Injectable()
export class AgentMemoryRepository {
  constructor(
    @Inject(getModelToken(AgentMemory.name))
    private readonly memoryModel: ReturnModelType<typeof AgentMemory>,
  ) {}

  /** 按 title 查找单条记忆 */
  async findByTitle(title: string): Promise<AgentMemory | null> {
    return this.memoryModel.findOne({ title });
  }

  /** 按类型查找记忆（用于 system prompt 注入） */
  async findByTypes(types: AgentMemoryType[]): Promise<AgentMemory[]> {
    return this.memoryModel
      .find({ type: { $in: types } })
      .sort({ updatedAt: -1 });
  }

  /** 查询所有记忆 */
  async findAll(): Promise<AgentMemory[]> {
    return this.memoryModel.find().sort({ updatedAt: -1 });
  }

  /**
   * 创建或更新记忆（upsert by title）。
   * title 已存在 → 更新 type / content / updatedAt
   * title 不存在 → 新建
   */
  async upsert(params: {
    type: AgentMemoryType;
    title: string;
    content: string;
  }): Promise<AgentMemory> {
    const now = new Date();
    const result = await this.memoryModel.findOneAndUpdate(
      { title: params.title },
      {
        $set: {
          type: params.type,
          content: params.content,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          createdAt: now,
        },
      },
      { upsert: true, new: true },
    );
    return result;
  }

  /** 按 title 删除记忆，不存在时静默返回 */
  async deleteByTitle(title: string): Promise<void> {
    await this.memoryModel.deleteOne({ title });
  }

  /** 按 _id 更新记忆（管理端用，只更新传入的非 undefined 字段） */
  async updateById(
    id: string,
    params: { type?: AgentMemoryType; title?: string; content?: string },
  ): Promise<AgentMemory | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (params.type !== undefined) updates.type = params.type;
    if (params.title !== undefined) updates.title = params.title;
    if (params.content !== undefined) updates.content = params.content;
    return this.memoryModel.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true },
    );
  }

  /** 按 _id 删除记忆（管理端用） */
  async deleteById(id: string): Promise<void> {
    await this.memoryModel.findByIdAndDelete(id);
  }

  /** 记忆总条数 */
  async count(): Promise<number> {
    return this.memoryModel.countDocuments();
  }

  // ─── session 类型专用方法 ──────────────────────────────────────────────────
  //
  // 设计要点：
  // 1. 一草稿一条 session 记忆——由 agentKey partial unique index 在数据库层保证，
  //    而非应用层 if-else，防止并发写入产生重复记录。
  // 2. title 用 `session:${agentKey}` 占位——满足 title unique 全局约束（不与 user 冲突），
  //    但 session 的唯一性语义以 agentKey 为准，不靠 title。
  // 3. tasks 与 content 分开更新（setTasks vs upsertSession），方便 Agent 独立更新写作计划，
  //    不必每次把 content 也一起传。

  /**
   * session 记忆 upsert（一草稿一条，by agentKey）。
   * content 传入更新后的会话摘要；title 用固定占位，唯一性靠 partial index 保证。
   */
  async upsertSession(agentKey: string, content: string): Promise<void> {
    const now = new Date();
    await this.memoryModel.updateOne(
      { type: 'session', agentKey },
      {
        $set: { content, updatedAt: now },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          type: 'session',
          agentKey,
          // title 固定占位：满足全局 unique 约束，session 唯一性语义在 agentKey
          title: `session:${agentKey}`,
          tasks: [],
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  /** 按 agentKey 查找 session 记忆，不存在时返回 null */
  async findSession(agentKey: string): Promise<AgentMemory | null> {
    return this.memoryModel.findOne({ type: 'session', agentKey });
  }

  /**
   * 更新某草稿 session 记忆的写作计划（tasks）。
   * 若 session 不存在则 upsert 创建（content 留空），保证操作幂等。
   */
  async setTasks(
    agentKey: string,
    tasks: Array<Record<string, unknown>>,
  ): Promise<void> {
    const now = new Date();
    await this.memoryModel.updateOne(
      { type: 'session', agentKey },
      {
        $set: { tasks, updatedAt: now },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          type: 'session',
          agentKey,
          title: `session:${agentKey}`,
          content: '',
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  /** 读取某草稿的写作计划；session 不存在时返回空数组 */
  async getTasks(agentKey: string): Promise<Array<Record<string, unknown>>> {
    const doc = await this.memoryModel.findOne(
      { type: 'session', agentKey },
      { tasks: 1 },
    );
    return (doc?.tasks as Array<Record<string, unknown>>) ?? [];
  }
}
