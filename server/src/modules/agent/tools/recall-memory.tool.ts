import { tool, jsonSchema } from 'ai';
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { toolResult } from './tool-result';

/**
 * recall_memory(#150 2026-05-31):按标题精确读一条 user 记忆全文。
 *
 * 配合 prompt 顶部 <memories_index> 只塞标题索引——agent 看到标题想看全文调这条;
 * 契约见 docs/agent-tools-redesign.md §3.10。
 *
 * 契约要点(对照 §1 ToolResult + §2 边角铁律):
 * - summary = 一行 TL;DR("已读取「X」· N 字"),前端 ToolCallCard 直接显示
 * - detail  = 全文,给模型读
 * - meta    = { status, memoryTitle, type }
 * - session 类型挡回:not_found + summary 不复述其 content,防 tasks/agentKey 内部字段泄漏
 */
export function createRecallMemoryTool(memoryRepo: AgentMemoryRepository) {
  return tool({
    description:
      '按标题精确读一条 user 记忆的全文(从 system prompt 顶部 <memories_index> 里的标题选)。' +
      '索引里看不到合适标题就别瞎调——直接基于已有上下文回答,或调 search_memories 模糊搜。',
    inputSchema: jsonSchema<{ title: string }>({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            '记忆标题,必须与 <memories_index> 中的某条精确一致(前后空格会被 trim)',
        },
      },
      required: ['title'],
    }),
    execute: async ({ title }: { title: string }) => {
      const normalized = title.trim();
      const memory = await memoryRepo.findByTitle(normalized);
      // session 类型是草稿级会话脉络(走 sessionMemory 注入 + read_conversation_history),
      // 不让 recall 触及——否则 content 里的 tasks/agentKey 等内部字段会被 detail 泄给模型
      if (!memory || memory.type !== 'user') {
        return toolResult(
          `没找到标题为「${normalized}」的 user 记忆,回看 <memories_index> 核对标题`,
          undefined,
          { status: 'not_found' },
        );
      }
      return toolResult(
        `已读取「${memory.title}」· ${memory.content.length} 字`,
        memory.content,
        {
          status: 'ok',
          memoryTitle: memory.title,
          type: memory.type,
        },
      );
    },
  });
}
