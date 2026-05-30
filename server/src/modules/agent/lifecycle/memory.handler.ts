/**
 * MemoryHandler — 记忆的读取。
 *
 * 职责：
 * - loadCore：加载 type=user 的记忆（注入标题索引；全文走 recall_memory 按需,#150）
 *
 * 设计:project 记忆类型已废弃(迁为 user);user 记忆原本全文注入,#150 改为只在
 * prompt 顶部塞标题索引(<memories_index>),要看任一条全文调 recall_memory(title);
 * 模糊查走 search_memories(query)。避免 user 记忆增长后 prompt 膨胀。
 */
import { Injectable } from '@nestjs/common';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import type { AgentMemory } from '../memory/agent-memory.entity';

@Injectable()
export class MemoryHandler {
  constructor(private readonly memoryRepo: AgentMemoryRepository) {}

  /** 加载用户核心记忆(type=user),注入标题索引;全文按需走 recall_memory 工具 */
  async loadCore(): Promise<AgentMemory[]> {
    return this.memoryRepo.findByTypes(['user']);
  }
}
