/**
 * SessionHandler — 会话生命周期中的读写操作封装。
 *
 * 职责：
 * - load：从数据库加载会话（含消息列表、摘要、轮数、最后活跃时间）
 * - save：持久化最新消息到数据库
 * - delete：删除整个会话
 *
 * 设计：不做任何业务逻辑判断，只负责数据存取，
 * 业务编排由 AgentLifecycle 负责。
 */
import { Injectable } from '@nestjs/common';
import { AgentSessionRepository } from '../session/agent-session.repository';

@Injectable()
export class SessionHandler {
  constructor(private readonly sessionRepo: AgentSessionRepository) {}

  /** 加载会话数据，不存在时返回空值（前端首次打开对话时的正常情况） */
  async load(sessionKey: string): Promise<{
    messages: Record<string, unknown>[];
    summary: string;
    totalRounds: number;
    tasks: Array<Record<string, unknown>>;
    lastActiveAt: Date | null;
  }> {
    const session = await this.sessionRepo.findByKey(sessionKey);
    return {
      messages: session?.messages ?? [],
      summary: session?.summary ?? '',
      totalRounds: session?.totalRounds ?? 0,
      tasks: (session?.tasks as unknown as Record<string, unknown>[]) ?? [],
      lastActiveAt: session?.lastActiveAt ?? null,
    };
  }

  /** 保存最新消息：totalRounds 按 assistant 消息数量统计 */
  async save(
    sessionKey: string,
    messages: Record<string, unknown>[],
  ): Promise<void> {
    const totalRounds = messages.filter((m) => m.role === 'assistant').length;
    await this.sessionRepo.upsert(sessionKey, messages, totalRounds);
  }

  /** 获取会话中的 tasks */
  async getTasks(sessionKey: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.sessionRepo.getTasks(sessionKey);
    return result ?? [];
  }

  /** 删除会话（清空对话历史） */
  async delete(sessionKey: string): Promise<void> {
    await this.sessionRepo.deleteByKey(sessionKey);
  }
}
