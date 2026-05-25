import { tool, jsonSchema } from 'ai';
import type { MemoryAgentService } from '../memory/memory-agent.service';
import { toolResult } from './tool-result';

/**
 * forget 工具：按描述匹配并删除一条记忆。
 */
export function createForgetTool(memoryAgent: MemoryAgentService) {
  return tool({
    description:
      '删除一条已过时或错误的记忆。尽量使用记忆的原始标题（可在 system prompt 的 core_memories 和 memory_index 中看到）。',
    inputSchema: jsonSchema<{ target: string }>({
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: '要忘记的记忆标题或描述',
          examples: ['量子计算入门文章的进展', '所有者职业背景'],
        },
      },
      required: ['target'],
      examples: [{ target: '量子计算入门文章的进展' }],
    }),
    execute: async ({ target }: { target: string }) => {
      const r = await memoryAgent.forget(target);
      return toolResult(r.message, undefined, { status: r.status });
    },
  });
}
