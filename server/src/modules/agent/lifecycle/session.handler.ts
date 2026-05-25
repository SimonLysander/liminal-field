/**
 * SessionHandler — 业务对话原文的写入封装(新架构:分段 + append-only)。
 *
 * 职责:
 * - save:append 本轮新增消息到最新段(撞存储上限自动开新段,永不覆盖删除)
 * - delete:删除该 agentKey 全部段
 *
 * 设计:不做任何业务逻辑判断,只负责数据存取,业务编排由 AgentLifecycle 负责。
 * 读取(分页/跨段聚合)由 AgentLifecycle 直接走 AgentSessionRepository,不经此封装。
 */
import { Injectable } from '@nestjs/common';
import { AgentSessionRepository } from '../session/agent-session.repository';

@Injectable()
export class SessionHandler {
  constructor(private readonly sessionRepo: AgentSessionRepository) {}

  /** append 本轮新增消息到最新段(分段自动管理,永不覆盖) */
  async save(
    agentKey: string,
    newMessages: Record<string, unknown>[],
  ): Promise<void> {
    await this.sessionRepo.appendMessages(agentKey, newMessages);
  }

  /** 删除该 agentKey 全部段(清空对话历史) */
  async delete(agentKey: string): Promise<void> {
    await this.sessionRepo.deleteByAgentKey(agentKey);
  }
}
