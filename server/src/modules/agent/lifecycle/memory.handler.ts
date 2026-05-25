/**
 * MemoryHandler — 记忆的读取。
 *
 * 职责：
 * - loadCore：加载 type=user 的记忆（始终全文注入 system prompt）
 *
 * 设计：project 记忆类型已废弃（迁为 user），原 loadIndex / autoRecall
 * 依赖 project 的逻辑随之删除。user 记忆全文注入即可，无需索引/召回。
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
}
