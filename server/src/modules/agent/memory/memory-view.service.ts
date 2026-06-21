/**
 * MemoryViewService(2026-05-30,#150 续 event log 架构)。
 *
 * 单一职责:**从 observations 派生 current_view markdown**,upsert 到单例。
 *
 * 不再做塑形决策 —— 决策权归主 agent 的 remember 工具。
 * 这里只做 view 渲染(类比相机焦外的模糊摘要)。
 *
 * 触发节奏(类比 compaction 的 token 占比触发,这里走时间 + 数量):
 *   - 距离上次 derivedAt > 7 天      (画像该不该刷新的时间窗)
 *   - OR 累积新观察 >= 15 条          (积压太多得早点刷)
 *   - OR 服务冷启动且有 observations (首次 bootstrap)
 *
 * 失败必 catch + log,绝不阻塞 onAfterChat 主路径。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { SystemConfigService } from '../../settings/system-config.service';
import { AgentMemoryObservationRepository } from './agent-memory-observation.repository';
import { type AgentMemoryObservation } from './agent-memory-observation.entity';
// 从 memory/profile-renderer.md 加载画像渲染器 prompt(原散落大段字符串 → promptManager 统一托管)
import { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

/** 触发阈值(常量,后续可考虑放 SystemConfig) */
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const REFRESH_OBSERVATION_DELTA = 15; // 累积 15 条新观察

@Injectable()
export class MemoryViewService {
  private readonly logger = new Logger(MemoryViewService.name);

  constructor(
    private readonly observationRepo: AgentMemoryObservationRepository,
    private readonly systemConfigService: SystemConfigService,
    // PromptManagerService 是 @Global() 注入,无需 module import
    private readonly promptManager: PromptManagerService,
  ) {}

  /**
   * onAfterChat 末尾调,内部判断是否真的需要刷新。
   *
   * - 没有 observations → 跳过
   * - 距上次 derivedAt < 7 天 AND 累积 < 15 条 → 跳过(节流)
   * - 否则触发 refresh
   *
   * **绝不抛出**:所有错误内部 catch + log。
   */
  async refreshIfNeeded(tier?: string): Promise<{
    triggered: boolean;
    reason: string;
  }> {
    try {
      const [totalCount, currentView] = await Promise.all([
        this.observationRepo.count(),
        this.observationRepo.findCurrentView(),
      ]);

      if (totalCount === 0) {
        return { triggered: false, reason: 'no observations' };
      }

      // 冷启动:有 observations 但没 view → 必须 bootstrap
      if (!currentView) {
        return await this.doRefresh(tier, totalCount, 'bootstrap');
      }

      const elapsedMs = Date.now() - new Date(currentView.derivedAt).getTime();
      const delta = totalCount - currentView.observationCount;

      // 双触发:时间窗 OR 累积数量
      if (
        elapsedMs < REFRESH_INTERVAL_MS &&
        delta < REFRESH_OBSERVATION_DELTA
      ) {
        return {
          triggered: false,
          reason: `节流:距上次 ${Math.round(elapsedMs / 3600000)}h(< 7d) + 累积 ${delta} 条(< 15)`,
        };
      }

      const reason =
        elapsedMs >= REFRESH_INTERVAL_MS
          ? `时间窗超阈(${Math.round(elapsedMs / 3600000)}h)`
          : `累积超阈(${delta} 条新观察)`;
      return await this.doRefresh(tier, totalCount, reason);
    } catch (err) {
      this.logger.error(
        `refreshIfNeeded 失败: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { triggered: false, reason: 'error' };
    }
  }

  /**
   * 强制刷新(SRE / 测试用,跳过节流判断)。
   */
  async forceRefresh(tier?: string): Promise<{
    triggered: boolean;
    reason: string;
  }> {
    try {
      const total = await this.observationRepo.count();
      if (total === 0) return { triggered: false, reason: 'no observations' };
      return await this.doRefresh(tier, total, 'force');
    } catch (err) {
      this.logger.error(
        `forceRefresh 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { triggered: false, reason: 'error' };
    }
  }

  // ─── 内部:派生 ─────────────────────────────────────────

  private async doRefresh(
    tier: string | undefined,
    totalCount: number,
    reason: string,
  ): Promise<{ triggered: boolean; reason: string }> {
    this.logger.debug(
      `refresh 触发(${reason}),共 ${totalCount} 条 observations`,
    );
    const all = await this.observationRepo.findAll();
    const markdown = await this.callViewLLM(all, tier);
    if (!markdown || markdown.trim().length === 0) {
      this.logger.warn('LLM 派生 view 返空,跳过 upsert');
      return { triggered: false, reason: 'llm returned empty' };
    }
    await this.observationRepo.upsertCurrentView({
      markdown: markdown.slice(0, 8000),
      observationCount: totalCount,
    });
    this.logger.debug(`refresh 完成,markdown ${markdown.length} 字`);
    return { triggered: true, reason };
  }

  private async getModel(tier: string = 'standard') {
    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    const provider = createOpenAICompatible({
      name: 'memory-view',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    return provider.chatModel(aiConfig.model);
  }

  /**
   * 把全量 observations 喂给 LLM,产出按 4 类 topic 分段的当前画像 markdown。
   *
   * 喂全量(YAGNI):真长期信号稀疏(一周 0-3 条),长期累积也只几百条,不爆 token。
   * 真到几千条再优化截断。
   */
  private async callViewLLM(
    observations: AgentMemoryObservation[],
    tier?: string,
  ): Promise<string> {
    const model = await this.getModel(tier);
    const observationsText = observations
      .map((o) => {
        const date = new Date(o.observedAt).toISOString().slice(0, 10);
        const ctx = o.context ? `\n  context: ${o.context}` : '';
        return `${date} [${o.topic}] ${o.observation}${ctx}`;
      })
      .join('\n\n');

    // 从 memory/profile-renderer.md 加载画像渲染器 prompt,注入 observations 文本
    const prompt = this.promptManager.render('memory/profile-renderer.md', {
      observations: observationsText,
    });

    const { text } = await generateText({ model, prompt });
    return text.trim();
  }
}
