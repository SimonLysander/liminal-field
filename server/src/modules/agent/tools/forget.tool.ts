import { tool, jsonSchema } from 'ai';
import type { MemoryAgentService } from '../memory/memory-agent.service';
import { toolResult } from './tool-result';

/**
 * forget 工具：按标题匹配并删除一条记忆。
 *
 * 数据安全设计(design §3.6 风险最高):
 * - 0 条匹配 → not_found(不删)
 * - 1 条命中 → 删并回执
 * - 多条强匹配 / 并列最高分 → ambiguous,**不删**,列候选让模型/用户再指明
 *
 * 模型使用约定(#150 后):
 * - target 取自 system prompt 顶部 <memories_index> 的原始标题(不是 core_memories,已废)
 * - 拿不准就先 recall_memory(title) 读全文确认,再调 forget
 */
export function createForgetTool(memoryAgent: MemoryAgentService) {
  return tool({
    description:
      '删除一条已过时或错误的记忆。target 用记忆原始标题(取自 <memories_index>)。' +
      '拿不准就先 recall_memory(title) 读全文确认再删——多条歧义会被拦下来不删,但精确标题最稳。',
    inputSchema: jsonSchema<{ target: string }>({
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            '要忘记的记忆标题(从 <memories_index> 复制原标题最稳;模糊描述会触发歧义保护不删)',
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
