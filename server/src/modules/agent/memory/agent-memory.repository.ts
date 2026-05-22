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
}
