import { Injectable, Logger } from '@nestjs/common';
import type { Agent } from '@earendil-works/pi-agent-core';
import { randomUUID } from 'node:crypto';

interface ActiveRun {
  runId: string;
  agent: Agent;
  startedAt: number;
}

/** 进程内运行协调：同一会话仅允许一个活跃 Pi agent，并提供显式取消入口。 */
@Injectable()
export class AgentRunManager {
  private readonly logger = new Logger(AgentRunManager.name);
  private readonly active = new Map<string, ActiveRun>();

  begin(sessionKey: string, agent: Agent): string {
    const existing = this.active.get(sessionKey);
    if (existing) {
      existing.agent.abort();
      this.logger.warn(
        `取消同会话旧运行 sessionKey=${sessionKey} runId=${existing.runId}`,
      );
    }
    const runId = randomUUID();
    this.active.set(sessionKey, { runId, agent, startedAt: Date.now() });
    this.logger.log(`运行开始 sessionKey=${sessionKey} runId=${runId}`);
    return runId;
  }

  finish(sessionKey: string, runId: string): void {
    const current = this.active.get(sessionKey);
    if (!current || current.runId !== runId) return;
    this.active.delete(sessionKey);
    this.logger.log(
      `运行结束 sessionKey=${sessionKey} runId=${runId} durationMs=${Date.now() - current.startedAt}`,
    );
  }

  cancel(sessionKey: string, expectedRunId?: string): boolean {
    const current = this.active.get(sessionKey);
    if (!current) return false;
    if (expectedRunId && current.runId !== expectedRunId) {
      this.logger.warn(
        `忽略过期取消 sessionKey=${sessionKey} expectedRunId=${expectedRunId} activeRunId=${current.runId}`,
      );
      return false;
    }
    // 先移除所有权再发送中止，使重复停止幂等，也允许新运行立即开始。
    this.active.delete(sessionKey);
    current.agent.abort();
    this.logger.log(`运行取消 sessionKey=${sessionKey} runId=${current.runId}`);
    return true;
  }
}
