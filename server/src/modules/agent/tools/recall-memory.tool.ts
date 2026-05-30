import { tool, jsonSchema } from 'ai';
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { toolResult } from './tool-result';

/**
 * recall_memory 工具(2026-05-31 引入,#150):按标题精确读取一条 user/project 记忆的全文。
 *
 * 设计:prompt 顶部只注入「记忆标题索引」(紧凑、让 Aurora 知道有哪些认知),
 * 真要看全文调这个工具。配合 user 原则「工具能提供的就不要一直注入」,
 * 避免把 10+ 条记忆全文塞 system prompt 膨胀 context。
 *
 * title 不匹配 → 返回 not_found,提示模型再看索引。
 */
export function createRecallMemoryTool(memoryRepo: AgentMemoryRepository) {
  return tool({
    description:
      '按标题精确读一条记忆的全文(从 system prompt 顶部「记忆索引」里的标题选)。' +
      '索引里看不到合适标题就别瞎调——直接基于已有上下文回答。',
    inputSchema: jsonSchema<{ title: string }>({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '记忆标题,必须与索引中的某条精确一致',
        },
      },
      required: ['title'],
    }),
    execute: async ({ title }: { title: string }) => {
      const memory = await memoryRepo.findByTitle(title.trim());
      // session 类型是草稿级会话脉络(走 sessionMemory 注入),不让 recall 直接读
      // (避免内部 tasks/agentKey 字段泄漏);只允许读 user 类型
      if (!memory || memory.type !== 'user') {
        return toolResult(
          `未找到标题为「${title}」的记忆。回到 system prompt 顶部「记忆索引」核对标题。`,
          undefined,
          { status: 'not_found' },
        );
      }
      return toolResult(`[${memory.title}]\n${memory.content}`, undefined, {
        status: 'ok',
      });
    },
  });
}
