/**
 * CompactionService — 对话压缩调度(新架构:token 触发,不删原文)。
 *
 * 触发标准从"轮数"改为"上下文 token 占窗口比例":
 * - 为什么用 token 而非轮数:固定轮数不反映真实占用,也不适配不同模型窗口(32k vs 128k);
 *   token 占比直接对应"上下文还剩多少空间",并把 system/记忆等固定开销一并算进分母。
 * - 为什么原文不删:messages 是给人翻看 + agent 精确回溯的业务原文,append-only 永不删。
 *   compaction 只把"超窗口那段最老的对话"提炼进 session 记忆,作为模型日常上下文的精炼替身;
 *   下次组装上下文只取最近 keepRatio 额度的原文,更早的精华已在 session 记忆里,不重复喂。
 *
 * LLM 调用和记忆写入委托给 MemoryAgentService。
 */
import { Injectable, Logger } from '@nestjs/common';
import { AgentSessionRepository } from './agent-session.repository';
import { MemoryAgentService } from '../memory/memory-agent.service';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { estimateTokens } from '../context/token-estimate';
import { splitForCompaction } from '../context/compaction-split';

/** compaction 占比参数(同标准:都是 token 占窗口比例,N < T) */
const TRIGGER_RATIO = 0.6; // T:总上下文占窗口达到 60% 触发压缩
const KEEP_RATIO = 0.3; // N:压缩后最近原文保留到占窗口 30% 额度内
/** system prompt + tools 定义等固定开销的保守预留(token),算固定开销 F 的一部分 */
const SYSTEM_RESERVE = 3000;

@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  constructor(
    private readonly sessionRepo: AgentSessionRepository,
    private readonly memoryAgent: MemoryAgentService,
    private readonly memoryRepo: AgentMemoryRepository,
  ) {}

  /**
   * 检查上下文是否超 60% 触发线,超了把最老的对话提炼进记忆(后台,用户无感)。
   *
   * 固定开销 F = user 记忆全文 + 本草稿 session 记忆 content + system/tools 预留常量。
   * 这与"喂模型上下文组装"的固定部分一致——保证触发判断用的分子和真实占用同口径。
   * 原文不删:只更新 session 记忆;"已提炼游标"靠"组装时按 token 倒取最近额度"隐式表达,无需显式存储。
   */
  async compactIfNeeded(
    agentKey: string,
    window: number,
    sourceSessionKey: string = agentKey,
  ): Promise<void> {
    const all = await this.sessionRepo.getAllMessages(sourceSessionKey);

    // 固定开销 F:与上下文组装的固定部分同口径
    const [userMems, sessionMem] = await Promise.all([
      this.memoryRepo.findByTypes(['user']),
      this.memoryRepo.findSession(agentKey),
    ]);
    const fixedTokens =
      estimateTokens(userMems.map((m) => m.content).join('\n')) +
      estimateTokens(sessionMem?.content ?? '') +
      SYSTEM_RESERVE;

    const { toCompact, toKeep } = splitForCompaction(all, {
      window,
      fixedTokens,
      triggerRatio: TRIGGER_RATIO,
      keepRatio: KEEP_RATIO,
    });

    this.logger.debug(
      `compactIfNeeded: agentKey=${agentKey} sourceSessionKey=${sourceSessionKey} window=${window} fixed=${fixedTokens} ` +
        `total=${all.length}条 toCompact=${toCompact.length} toKeep=${toKeep.length}`,
    );

    if (toCompact.length === 0) return;

    // 提炼最老的一段进 session 记忆(原文不删)
    await this.memoryAgent.compact(
      agentKey,
      toCompact,
      sessionMem?.content ?? '',
    );

    this.logger.debug(
      `compactIfNeeded: agentKey=${agentKey} 已提炼 ${toCompact.length} 条进 session 记忆(原文保留)`,
    );
  }
}
