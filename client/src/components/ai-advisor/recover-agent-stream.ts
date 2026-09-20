import {
  getActiveRun,
  loadSession,
  type AgentRunStatus,
  type SessionData,
} from '@/services/agent';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agent-stream-recovery');
const RECOVERY_DEADLINE_MS = 20 * 60 * 1000;
const RUNNING_POLL_MS = 2_000;
const IDLE_READ_DELAY_MS = 750;
const MAX_IDLE_READS = 4;

type RecoveryDependencies = {
  getRun?: (sessionKey: string) => Promise<AgentRunStatus>;
  load?: (
    sessionKey: string,
    options: { agentInstanceKey?: string },
  ) => Promise<SessionData>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

type RecoverAgentStreamOptions = {
  sessionKey: string;
  agentInstanceKey?: string;
  pendingMessageId?: string;
  isCancelled: () => boolean;
};

/**
 * 等待后端运行结束并读取已持久化的完整会话。
 *
 * 返回 undefined 表示后端已经空闲，但没有找到本轮完整回复；调用方应保留原始错误。
 * 网络尚未恢复时会继续等待，不把一次轮询失败误判成 Agent 失败。
 */
export async function recoverAgentStream(
  options: RecoverAgentStreamOptions,
  dependencies: RecoveryDependencies = {},
): Promise<SessionData | undefined> {
  const getRun = dependencies.getRun ?? getActiveRun;
  const load = dependencies.load ?? loadSession;
  const wait =
    dependencies.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;
  const deadline = now() + RECOVERY_DEADLINE_MS;
  let idleReads = 0;

  while (!options.isCancelled() && now() < deadline) {
    try {
      const run = await getRun(options.sessionKey);
      if (options.isCancelled()) return undefined;
      if (run.status === 'running') {
        idleReads = 0;
        await wait(RUNNING_POLL_MS);
        continue;
      }

      const data = await load(options.sessionKey, {
        agentInstanceKey: options.agentInstanceKey,
      });
      if (options.isCancelled()) return undefined;
      if (hasCompletedTurn(data.messages, options.pendingMessageId)) {
        return data;
      }

      // 服务端状态会在持久化后才转 idle；额外短读用于兼容 Mongo 可见性的瞬时延迟。
      idleReads += 1;
      if (idleReads >= MAX_IDLE_READS) return undefined;
      await wait(IDLE_READ_DELAY_MS);
    } catch (error) {
      logger.debug('poll_failed', {
        sessionKey: options.sessionKey,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await wait(RUNNING_POLL_MS);
    }
  }

  return undefined;
}

/** 本轮 user message 已落库，并且其后存在可展示的 assistant 内容，才算恢复成功。 */
export function hasCompletedTurn(
  messages: Record<string, unknown>[],
  pendingMessageId?: string,
): boolean {
  if (!pendingMessageId) return false;
  const userIndex = messages.findIndex(
    (message) => message.id === pendingMessageId,
  );
  if (userIndex < 0) return false;

  return messages.slice(userIndex + 1).some((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) {
      return false;
    }
    return message.parts.some((part) => {
      if (!part || typeof part !== 'object') return false;
      const typed = part as { type?: unknown; text?: unknown };
      return (
        typed.type === 'text' &&
        typeof typed.text === 'string' &&
        typed.text.trim().length > 0
      );
    });
  });
}
