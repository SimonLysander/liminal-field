/**
 * SessionHandler — 业务对话原文的读写封装(新架构:分段 + append-only)。
 *
 * 职责:
 * - load:跨段聚合取最近一段额度的对话原文(完整分页留到 U5)
 * - save:append 本轮新增消息到最新段(撞存储上限自动开新段,永不覆盖删除)
 * - delete:删除该 agentKey 全部段
 *
 * 设计:不做任何业务逻辑判断,只负责数据存取,业务编排由 AgentLifecycle 负责。
 * summary / tasks 不再属于业务对话(迁到 agent 记忆),此处不再读写。
 */
import { Injectable } from '@nestjs/common';
import { AgentSessionRepository } from '../session/agent-session.repository';

/** load 默认取最近条数上限:真正的 token 裁剪由上层组装时按窗口额度做 */
const LOAD_RECENT_LIMIT = 200;

@Injectable()
export class SessionHandler {
  constructor(private readonly sessionRepo: AgentSessionRepository) {}

  /** 加载会话原文(跨段倒取最近 N 条,正序);不存在时返回空 */
  async load(agentKey: string): Promise<{
    messages: Record<string, unknown>[];
    totalRounds: number;
    lastActiveAt: Date | null;
  }> {
    const [messages, latest] = await Promise.all([
      this.sessionRepo.getRecentMessages(agentKey, LOAD_RECENT_LIMIT),
      this.sessionRepo.findLatestSeg(agentKey),
    ]);
    return {
      messages,
      // totalRounds 过渡保留:用本次取回的 assistant 条数近似(旧字段 U6 清理)
      totalRounds: messages.filter((m) => m.role === 'assistant').length,
      lastActiveAt: latest?.lastActiveAt ?? null,
    };
  }

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
