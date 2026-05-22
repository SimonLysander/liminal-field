import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { getModelToken } from 'nestjs-typegoose';
import { AgentSession } from './agent-session.entity';

/**
 * AgentSessionRepository — 会话的存取层。
 *
 * 只做数据读写，不含业务逻辑（compaction 逻辑在 service 层）。
 */
@Injectable()
export class AgentSessionRepository {
  constructor(
    @Inject(getModelToken(AgentSession.name))
    private readonly sessionModel: ReturnModelType<typeof AgentSession>,
  ) {}

  /** 按 sessionKey 查找会话，不存在返回 null */
  async findByKey(sessionKey: string): Promise<AgentSession | null> {
    return this.sessionModel.findOne({ sessionKey });
  }

  /** 保存会话消息 + 轮数（每次 AI 回复完成后调用） */
  async upsert(
    sessionKey: string,
    messages: Record<string, unknown>[],
    totalRounds: number,
  ): Promise<AgentSession> {
    const now = new Date();
    const result = await this.sessionModel.findOneAndUpdate(
      { sessionKey },
      {
        $set: { messages, totalRounds, lastActiveAt: now },
        $setOnInsert: {
          _id: new Types.ObjectId(),
          summary: '',
          createdAt: now,
        },
      },
      { upsert: true, new: true },
    );
    return result;
  }

  /** compaction 后更新：新摘要 + 裁剪后的消息 + 轮数 */
  async updateAfterCompaction(
    sessionKey: string,
    summary: string,
    messages: Record<string, unknown>[],
    totalRounds: number,
  ): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionKey },
      { $set: { summary, messages, totalRounds, lastActiveAt: new Date() } },
    );
  }

  /** 添加一个 task 到 session 的 tasks 数组 */
  async addTask(
    sessionKey: string,
    task: Record<string, unknown>,
  ): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionKey },
      { $push: { tasks: task } },
    );
  }

  /** 更新 session 中某个 task 的字段（按 task id 匹配） */
  async updateTask(
    sessionKey: string,
    taskId: string,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const setFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      setFields[`tasks.$.${key}`] = value;
    }
    await this.sessionModel.updateOne(
      { sessionKey, 'tasks.id': taskId },
      { $set: setFields },
    );
  }

  /** 获取 session 的 tasks 列表 */
  async getTasks(sessionKey: string): Promise<Array<Record<string, unknown>>> {
    const session = await this.sessionModel.findOne(
      { sessionKey },
      { tasks: 1 },
    );
    return (session?.tasks as unknown as Array<Record<string, unknown>>) ?? [];
  }

  /** 删除指定会话 */
  async deleteByKey(sessionKey: string): Promise<void> {
    await this.sessionModel.deleteOne({ sessionKey });
  }
}
