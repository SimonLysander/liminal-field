import { tool, jsonSchema } from 'ai';
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { toolResult } from './tool-result';

/**
 * search_memories 工具(2026-05-31 引入,#150):按 query 模糊搜 user 记忆。
 *
 * 设计:prompt 顶部已注入 user 记忆**标题索引**;索引外想看(模糊匹配标题/内容)走这,
 * 返回最多 10 条候选标题(不返全文)。模型挑一个再调 recall_memory(title) 读全文。
 *
 * 类型说明:AgentMemoryType 只有 'user' / 'session' 两种,session 是草稿级会话脉络
 * (走 sessionMemory 注入 + read_conversation_history 工具,不进 search);user 才是
 * 长期认知,这里只搜 user。
 */
const MAX_RESULTS = 10;

export function createSearchMemoriesTool(memoryRepo: AgentMemoryRepository) {
  return tool({
    description:
      '按关键词模糊搜 user 记忆(标题 + 内容),返回最多 10 条候选标题。' +
      '索引里看不到合适标题就来这搜;查到候选后用 recall_memory(title) 读全文。',
    inputSchema: jsonSchema<{ query: string }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词(模糊匹配 title + content)。空串则按更新时间倒序',
        },
      },
      required: ['query'],
    }),
    execute: async ({ query }: { query: string }) => {
      // 简单模糊匹配:取 user 全量 → 内存里 case-insensitive 过滤
      // 个人 KB 规模(< 1000 条)直接全表过滤即可,无需上索引
      const all = await memoryRepo.findByTypes(['user']);
      const q = query.trim().toLowerCase();
      const matched = q
        ? all.filter(
            (m) =>
              m.title.toLowerCase().includes(q) ||
              m.content.toLowerCase().includes(q),
          )
        : all;
      const candidates = matched.slice(0, MAX_RESULTS);

      if (candidates.length === 0) {
        return toolResult(
          `没找到匹配「${query}」的记忆。`,
          undefined,
          { status: 'not_found' },
        );
      }

      const lines = candidates.map((m) => `- ${m.title}`).join('\n');
      const more =
        matched.length > MAX_RESULTS
          ? `\n(还有 ${matched.length - MAX_RESULTS} 条匹配,优化 query 缩小范围)`
          : '';
      return toolResult(
        `${candidates.length} 条候选(挑一个调 recall_memory(title) 读全文):\n${lines}${more}`,
        undefined,
        { status: 'ok' },
      );
    },
  });
}
