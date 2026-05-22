/**
 * MemoryHandler — 记忆的读取与自动召回。
 *
 * 职责：
 * - loadCore：加载 type=user 的记忆（始终全文注入 system prompt）
 * - loadIndex：加载 type=project 的记忆索引（只注入标题）
 * - autoRecall：按文档标题分词匹配相关 project 记忆（全文）
 *
 * 设计：autoRecall 失败降级为空数组，由 AgentLifecycle 的 try/catch 保障，
 * 不影响主流程。
 */
import { Injectable } from '@nestjs/common';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import type { AgentMemory } from '../memory/agent-memory.entity';

@Injectable()
export class MemoryHandler {
  constructor(private readonly memoryRepo: AgentMemoryRepository) {}

  /** 加载用户核心记忆（type=user），始终全文注入 system prompt */
  async loadCore(): Promise<AgentMemory[]> {
    return this.memoryRepo.findByTypes(['user']);
  }

  /** 加载项目记忆索引（type=project），只注入标题，按需读取详情 */
  async loadIndex(): Promise<AgentMemory[]> {
    return this.memoryRepo.findByTypes(['project']);
  }

  /**
   * 按文档标题自动召回相关 project 记忆。
   *
   * 策略：把文档标题按 CJK 字符和空白拆分成 tokens，
   * 过滤出 title 中包含任意 token 的记忆，全文返回。
   * 没有 documentTitle 时直接返回空数组（非编辑器入口的正常情况）。
   */
  async autoRecall(documentTitle?: string): Promise<AgentMemory[]> {
    if (!documentTitle) return [];

    const projectMemories = await this.memoryRepo.findByTypes(['project']);
    if (projectMemories.length === 0) return [];

    // 分词：按空白、标点切割，过滤空串和长度小于 2 的单字
    const tokens = documentTitle
      .split(/[\s，。、！？,.!?]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    if (tokens.length === 0) return [];

    return projectMemories.filter((memory) =>
      tokens.some((token) => memory.title.includes(token)),
    );
  }
}
