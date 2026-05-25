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
import { AgentMemoryRepository } from './agent-memory.repository';
import type { AgentMemory } from './agent-memory.entity';

interface RememberResult {
  action: 'create' | 'update';
  type: 'user' | 'project';
  title: string;
  content: string;
}

interface CompactResult {
  summary: string;
  memories: Array<{
    action: 'create' | 'update';
    type: 'user' | 'project';
    title: string;
    content: string;
  }>;
}

@Injectable()
export class MemoryAgentService {
  private readonly logger = new Logger(MemoryAgentService.name);

  constructor(
    private readonly memoryRepo: AgentMemoryRepository,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async remember(content: string, tier?: string): Promise<string> {
    const existingMemories = await this.memoryRepo.findAll();

    try {
      const result = await this.callRememberLLM(
        content,
        existingMemories,
        tier,
      );

      await this.memoryRepo.upsert({
        type: result.type,
        title: result.title,
        content: result.content,
      });

      const verb = result.action === 'update' ? '合并到' : '新建';
      return `已记住：${verb} [${result.type}] ${result.title}`;
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

  async compact(
    oldMessages: Record<string, unknown>[],
    oldSummary: string,
    tier?: string,
  ): Promise<{ summary: string; memoriesExtracted: number }> {
    const existingMemories = await this.memoryRepo.findAll();
    const inputText = this.buildConversationText(oldMessages, oldSummary);

    try {
      const result = await this.callCompactLLM(
        inputText,
        existingMemories,
        tier,
      );

      if (result.memories.length > 0) {
        await Promise.all(
          result.memories.map((mem) =>
            this.memoryRepo.upsert({
              type: mem.type,
              title: mem.title,
              content: mem.content,
            }),
          ),
        );
      }

      this.logger.log(
        `Memory Agent compact：提取 ${result.memories.length} 条记忆`,
      );
      return {
        summary: result.summary,
        memoriesExtracted: result.memories.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Compact 失败: ${msg}`);
      return { summary: oldSummary, memoriesExtracted: 0 };
    }
  }

  // ── 内部方法 ──

  private buildConversationText(
    messages: Record<string, unknown>[],
    oldSummary: string,
  ): string {
    const parts: string[] = [];
    if (oldSummary) {
      parts.push(`<previous_summary>\n${oldSummary}\n</previous_summary>`);
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
      prompt: `你是一个记忆管理器。将新信息整合到记忆库中。

已有记忆：
${this.formatExistingMemories(existingMemories)}

新信息：
${newContent}

规则：
- 判断新信息是关于所有者本人（type: user）还是关于某件具体事（type: project）
- 检查已有记忆中是否有相关条目：有 → action: update，合并内容；没有 → action: create
- user 类型：通用偏好、背景、习惯。只有明确表达为通用时才归 user
- project 类型：特定事情的进展、决策、上下文。不确定时归 project
- update 时保留已有内容中仍然有效的部分，追加新信息
- title 要简洁明确（中文）

请只输出 JSON，格式：
{"action": "create 或 update", "type": "user 或 project", "title": "标题", "content": "完整内容"}`,
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
      prompt: `你是一个记忆管理器。处理以下对话记录，输出 JSON 包含两部分：

1. summary：将对话压缩为摘要（保留关键事实、决策、未解决的问题）

2. memories：提取值得长期记住的信息数组。
   已有记忆：
   ${this.formatExistingMemories(existingMemories)}

   提取规则：
   - 只提取跨对话有价值的信息，不要提取临时细节
   - 已有记忆中已包含的信息不要重复提取
   - 所有者明确说的通用偏好 → type: user
   - 关于某件具体事 → type: project
   - 不确定时归 project
   - 如果没有值得提取的信息，memories 为空数组

请只输出 JSON，格式：
{"summary": "摘要文本", "memories": [{"action": "create 或 update", "type": "user 或 project", "title": "标题", "content": "内容"}]}

${inputText}`,
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

/**
 * 从 LLM 文本响应中提取 JSON。纯函数，便于单测——提取失败会让记忆写入整链崩。
 * 兼容：纯 JSON、```json 代码块、花括号截取。
 */
export function extractJSON<T>(text: string): T {
  // 尝试直接解析
  try {
    return JSON.parse(text) as T;
  } catch {
    // 不是纯 JSON
  }
  // 尝试从 ```json ... ``` 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]) as T;
  }
  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
  }
  throw new Error('LLM 响应中未找到有效 JSON');
}
