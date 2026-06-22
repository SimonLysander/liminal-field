/**
 * MemoryAgentService — 记忆管理 Agent。
 *
 * 所有记忆写入的统一入口：remember / forget / compact。
 *
 * 用 generateText（非 generateObject）做 LLM 调用，手动解析 JSON。
 * 原因：generateObject 要求 provider 支持 structured output / response_format，
 * DeepSeek 等 OpenAI-compatible provider 不一定支持。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { SystemConfigService } from '../../settings/system-config.service';
// extractJSON 已上移到 agent.utils(LLM JSON 提取是 agent 通用工具,digest-compose 也复用)
import { extractJSON } from '../agent.utils';
import { AgentMemoryRepository } from './agent-memory.repository';
import type { AgentMemory } from './agent-memory.entity';
// 从 memory/owner-memory.md 和 memory/session-compactor.md 加载 prompt(原散落字符串 → promptManager 统一托管)
import { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

interface RememberResult {
  action: 'create' | 'update';
  title: string;
  content: string;
}

/**
 * compaction LLM 产物(新架构)。
 *
 * 不再产 summary——压缩边界处的脉络直接进 session 记忆 content,user 画像进 user 记忆。
 * - sessionContent:本草稿会话活摘要,替代旧 summary 的位置(进 agent_lux_memories session 记录)
 * - userMemories:从旧对话顺带提炼的所有者画像(全局 user 记忆,跨草稿)
 */
interface CompactResult {
  sessionContent: string;
  userMemories: Array<{ title: string; content: string }>;
}

@Injectable()
export class MemoryAgentService {
  private readonly logger = new Logger(MemoryAgentService.name);

  constructor(
    private readonly memoryRepo: AgentMemoryRepository,
    private readonly systemConfigService: SystemConfigService,
    // PromptManagerService 是 @Global() 注入,无需 module import
    private readonly promptManager: PromptManagerService,
  ) {}

  async remember(content: string, tier?: string): Promise<string> {
    const existingMemories = await this.memoryRepo.findAll();

    try {
      const result = await this.callRememberLLM(
        content,
        existingMemories,
        tier,
      );

      // remember 只写 user 记忆(所有者画像):project 类型已废弃,session 记忆由 compaction 内部维护。
      await this.memoryRepo.upsert({
        type: 'user',
        title: result.title,
        content: result.content,
      });

      const verb = result.action === 'update' ? '合并到' : '新建';
      return `已记住：${verb} ${result.title}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Remember 失败: ${msg}`);
      return `记忆保存失败：${msg}`;
    }
  }

  async forget(
    description: string,
  ): Promise<{ status: 'ok' | 'not_found' | 'ambiguous'; message: string }> {
    const allMemories = await this.memoryRepo.findAll();
    if (allMemories.length === 0)
      return { status: 'not_found', message: '没有任何记忆可以删除' };

    const scored = allMemories.map((m) => ({
      memory: m,
      score: matchScore(description, m.title + ' ' + m.content),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score === 0)
      return {
        status: 'not_found',
        message: `没有找到与「${description}」相关的记忆`,
      };

    // 歧义:并列最高分,或多条强匹配(≥0.5)——不删,列候选让上层指明(数据安全)
    const tied = scored.filter((s) => s.score === best.score);
    const strong = scored.filter((s) => s.score >= 0.5);
    const candidates = tied.length > 1 ? tied : strong;
    if (candidates.length > 1) {
      const list = candidates
        .slice(0, 5)
        .map((s) => s.memory.title)
        .join('、');
      return {
        status: 'ambiguous',
        message: `匹配到多条,未删除,请指明要删哪条:${list}`,
      };
    }

    await this.memoryRepo.deleteByTitle(best.memory.title);
    return { status: 'ok', message: `已忘记「${best.memory.title}」` };
  }

  /**
   * 把超窗口的旧对话提炼进记忆(不再产 summary)。
   *
   * 为什么不删原文:messages 原文完整保留供人翻看 + agent 精确回溯;
   * compaction 只把"超窗口那段旧对话"的脉络提炼进 session 记忆,作为模型日常上下文的精炼替身。
   *
   * 压缩策略(prompt 核心):以用户每轮意图/问题为骨架,按话题组织——
   * 「话题 → 用户想解决什么 → 达成的结论/产出」,保留意图+结论双维度,丢弃冗长过程/重复试错。
   *
   * 产物:
   * - 覆盖本草稿 session 记忆 content(活摘要,prevSessionContent 作为已有脉络一并喂给 LLM 合并)
   * - 顺带提炼的 user 记忆(全局画像,upsert by title)
   */
  async compact(
    agentKey: string,
    oldMessages: Record<string, unknown>[],
    prevSessionContent: string,
    tier?: string,
  ): Promise<{ memoriesExtracted: number }> {
    // 已有 user 记忆喂给 LLM,避免重复提取
    const existingMemories = await this.memoryRepo.findByTypes(['user']);
    const inputText = this.buildConversationText(
      oldMessages,
      prevSessionContent,
    );

    try {
      const result = await this.callCompactLLM(
        inputText,
        existingMemories,
        tier,
      );

      // session 记忆 content:本草稿一条,by agentKey 覆盖(活摘要)
      await this.memoryRepo.upsertSession(agentKey, result.sessionContent);

      // 顺带提炼的 user 记忆:全局画像,upsert by title
      if (result.userMemories.length > 0) {
        await Promise.all(
          result.userMemories.map((mem) =>
            this.memoryRepo.upsert({
              type: 'user',
              title: mem.title,
              content: mem.content,
            }),
          ),
        );
      }

      this.logger.debug(
        `compact: agentKey=${agentKey} 更新 session 记忆 + ${result.userMemories.length} 条 user 记忆`,
      );
      return { memoriesExtracted: result.userMemories.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`compact 失败 agentKey=${agentKey}: ${msg}`);
      return { memoriesExtracted: 0 };
    }
  }

  // ── 内部方法 ──

  private buildConversationText(
    messages: Record<string, unknown>[],
    prevSessionContent: string,
  ): string {
    const parts: string[] = [];
    // 已有 session 记忆脉络:让 LLM 在其基础上合并新提炼的话题,而非另起炉灶
    if (prevSessionContent) {
      parts.push(
        `<previous_session_memory>\n${prevSessionContent}\n</previous_session_memory>`,
      );
    }
    parts.push('<conversation>');
    for (const msg of messages) {
      const role = msg.role as string;
      const contentParts = msg.parts as
        | Array<{ type: string; text?: string }>
        | undefined;
      const text =
        contentParts
          ?.filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('') ||
        (msg.content as string) ||
        '';
      parts.push(`[${role}]: ${text}`);
    }
    parts.push('</conversation>');
    return parts.join('\n');
  }

  private async getModel(tier: string = 'standard') {
    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    const provider = createOpenAICompatible({
      name: 'memory-agent',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    return provider.chatModel(aiConfig.model);
  }

  private formatExistingMemories(memories: AgentMemory[]): string {
    if (memories.length === 0) return '（暂无已有记忆）';
    return memories
      .map((m) => `[${m.type}] ${m.title}: ${m.content.slice(0, 100)}`)
      .join('\n');
  }

  private async callRememberLLM(
    newContent: string,
    existingMemories: AgentMemory[],
    tier?: string,
  ): Promise<RememberResult> {
    const model = await this.getModel(tier);
    const { text } = await generateText({
      model,
      // 记忆只存所有者画像(user):背景/偏好/习惯/写作风格等跨会话长期有效的信息。
      // project 类型已废弃,不再让模型区分类型。
      // 从 memory/owner-memory.md 加载记忆管理器 prompt(原散落字符串 → promptManager 统一托管)
      prompt: this.promptManager.render('memory/owner-memory.md', {
        existing_memories: this.formatExistingMemories(existingMemories),
        new_content: newContent,
      }),
    });
    return extractJSON<RememberResult>(text);
  }

  private async callCompactLLM(
    inputText: string,
    existingMemories: AgentMemory[],
    tier?: string,
  ): Promise<CompactResult> {
    const model = await this.getModel(tier);
    const { text } = await generateText({
      model,
      // 压缩策略:以"用户意图为骨架"组织 sessionContent(保留意图+结论双维度,丢冗长过程),
      // 顺带把所有者画像沉淀为 user 记忆。不再产 summary——脉络的归宿就是 session 记忆 content。
      // 从 memory/session-compactor.md 加载会话压缩器 prompt(原散落字符串 → promptManager 统一托管)
      prompt: this.promptManager.render('memory/session-compactor.md', {
        existing_memories: this.formatExistingMemories(existingMemories),
        input_text: inputText,
      }),
    });
    return extractJSON<CompactResult>(text);
  }
}

/** description 按空格分词(过滤 <2 字符)，返回命中 target 的词占比 [0,1]。纯函数，便于单测。 */
export function matchScore(description: string, target: string): number {
  const words = description.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => target.includes(w)).length;
  return hits / words.length;
}
