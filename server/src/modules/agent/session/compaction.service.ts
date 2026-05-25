/**
 * CompactionService — 对话压缩调度。
 *
 * 只做两件事：判断是否触发 + 消息切分。
 * LLM 调用和记忆写入委托给 MemoryAgentService。
 */
import { Injectable, Logger } from '@nestjs/common';
import { AgentSessionRepository } from './agent-session.repository';
import { MemoryAgentService } from '../memory/memory-agent.service';

/** compaction 参数 */
const KEEP_ROUNDS = 8; // N：保留最近几轮完整消息
const TRIGGER_ROUNDS = 16; // T：总轮数达到多少触发压缩

@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly sessionRepo: AgentSessionRepository,
    private readonly memoryAgent: MemoryAgentService,
  ) {}

  /** 检查是否需要 compaction，需要则执行。 */
  async compactIfNeeded(sessionKey: string): Promise<void> {
    const session = await this.sessionRepo.findByKey(sessionKey);
    if (!session || session.totalRounds < TRIGGER_ROUNDS) return;

    this.logger.log(
      `Session "${sessionKey}" 达到 ${session.totalRounds} 轮，触发 compaction`,
    );

    const { toCompact, toKeep } = splitMessages(session.messages, KEEP_ROUNDS);
    if (toCompact.length === 0) return;

    try {
      // 委托给 Memory Agent：压缩摘要 + 提取记忆
      const { summary, memoriesExtracted } = await this.memoryAgent.compact(
        toCompact,
        session.summary,
      );

      // 重置 totalRounds 为保留的轮数，避免下次 save 又触发 compaction
      const keptRounds = toKeep.filter((m) => m.role === 'assistant').length;
      await this.sessionRepo.updateAfterCompaction(
        sessionKey,
        summary,
        toKeep,
        keptRounds,
      );

      this.logger.log(
        `Compaction 完成：压缩 ${toCompact.length} 条消息，提取 ${memoriesExtracted} 条记忆`,
      );
    } catch (err) {
      this.logger.error('Compaction 失败', err);
    }
  }
}

/**
 * 按轮数切分消息：保留最后 keepRounds 轮，其余归入 toCompact。
 * 纯函数（零依赖 this），独立导出便于单测——压缩切错位置会丢对话，是关键路径。
 */
export function splitMessages(
  messages: Record<string, unknown>[],
  keepRounds: number,
): {
  toCompact: Record<string, unknown>[];
  toKeep: Record<string, unknown>[];
} {
  let assistantCount = 0;
  // 默认全保留(splitIndex=0)：消息不足 keepRounds 轮时不压缩。
  // 生产触发 compaction 时 totalRounds>=16>keepRounds，循环必能找到真正的分割点。
  let splitIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantCount++;
      if (assistantCount === keepRounds) {
        let j = i - 1;
        while (j >= 0 && messages[j].role !== 'user') j--;
        splitIndex = j >= 0 ? j : i;
        break;
      }
    }
  }
  return {
    toCompact: messages.slice(0, splitIndex),
    toKeep: messages.slice(splitIndex),
  };
}
