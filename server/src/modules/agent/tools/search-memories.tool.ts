import { tool, jsonSchema } from 'ai';
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { toolResult } from './tool-result';

/**
 * search_memories(#150 2026-05-31):模糊搜 user 记忆。
 *
 * 配合 prompt 顶部 <memories_index> 标题索引:索引外想找(模糊匹配标题/内容)走这条;
 * 查到候选标题后用 recall_memory(title) 读全文。契约见 docs/agent-tools-redesign.md §3.11。
 *
 * 契约要点(对照 §1 ToolResult + §2 边角铁律):
 * - summary = 一行 TL;DR("命中 N 条:A、B、C …")
 * - detail  = 本页候选列表,每条 "- 标题"
 * - meta    = { status, total, shown, offset, hasMore, nextOffset } —— 铁律 1"不静默丢"
 * - 不搜 session 类型:防内部会话脉络命中泄漏(与 recall 一致策略)
 */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function createSearchMemoriesTool(memoryRepo: AgentMemoryRepository) {
  return tool({
    description:
      '模糊搜 user 记忆(匹配标题 + 内容,case-insensitive),返回候选标题列表(不返全文)。' +
      '索引里看不到合适标题就来这搜;查到候选后用 recall_memory(title) 读全文。' +
      '截断时 meta 会给 hasMore + nextOffset,可用 offset 续取。',
    inputSchema: jsonSchema<{
      query: string;
      limit?: number;
      offset?: number;
    }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '关键词(模糊匹配 title + content);空串则按更新时间倒序返全部',
        },
        limit: {
          type: 'number',
          description: `单页条数,默认 ${DEFAULT_LIMIT},上限 ${MAX_LIMIT}`,
        },
        offset: {
          type: 'number',
          description: '续取偏移(对应上一页 meta.nextOffset),默认 0',
        },
      },
      required: ['query'],
    }),
    execute: async ({
      query,
      limit,
      offset,
    }: {
      query: string;
      limit?: number;
      offset?: number;
    }) => {
      const effLimit = Math.min(
        Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)),
        MAX_LIMIT,
      );
      const effOffset = Math.max(0, Math.floor(offset ?? 0));

      // 简单模糊匹配:取 user 全量 → 内存里 case-insensitive 过滤
      // 个人 KB 规模(< 1000 条)直接全表过滤即可,无需上索引
      // 不搜 session 类型——防 tasks/agentKey 等内部字段命中后泄给模型
      const all = await memoryRepo.findByTypes(['user']);
      const q = query.trim().toLowerCase();
      const matched = q
        ? all.filter(
            (m) =>
              m.title.toLowerCase().includes(q) ||
              m.content.toLowerCase().includes(q),
          )
        : all;
      const total = matched.length;
      const page = matched.slice(effOffset, effOffset + effLimit);
      const shown = page.length;
      const nextOffset = effOffset + shown;
      const hasMore = nextOffset < total;

      if (total === 0) {
        return toolResult(
          q ? `没找到匹配「${query}」的记忆` : '当前没有 user 记忆',
          undefined,
          { status: 'not_found', total: 0 },
        );
      }

      // summary:头 3 个标题 + 总数(对照 §3.1 search_knowledge_base 风格)
      const previewTitles = page
        .slice(0, 3)
        .map((m) => m.title)
        .join('、');
      const summary = q
        ? `命中 ${total} 条:${previewTitles}${total > 3 ? ' …' : ''}`
        : `共 ${total} 条:${previewTitles}${total > 3 ? ' …' : ''}`;

      // detail:本页所有候选,每条一行
      const detail = page.map((m) => `- ${m.title}`).join('\n');

      return toolResult(summary, detail, {
        status: 'ok',
        total,
        shown,
        offset: effOffset,
        hasMore,
        nextOffset: hasMore ? nextOffset : undefined,
        // list:候选标题数组,给前端 ToolCallCard 的 NestedList 渲染(⎿ 对齐)。
        // 与 search_knowledge_base 同约定;contract §3.11 已注明。
        list: page.map((m) => m.title),
      });
    },
  });
}
