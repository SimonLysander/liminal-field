import { tool, jsonSchema } from 'ai';
import type { AgentSessionRepository } from '../session/agent-session.repository';
import { toolResult } from './tool-result';

/**
 * read_conversation_history — 读本草稿的对话原文(跨段)。
 *
 * 为什么需要这个工具：session 记忆是有损精炼(compaction 后只保留摘要)，
 * 精确查询"用户原话是什么"/"我们讨论过 X 没有"时，摘要兜不住——
 * 必须回溯原始对话流。此工具跨段聚合全部消息，支持按关键词过滤，
 * 避免 agent 靠记忆猜测，减少幻觉。
 *
 * 注意：仅读当前草稿(agentKey)的对话历史，不跨草稿。
 */
export function createReadConversationHistoryTool(
  sessionRepo: AgentSessionRepository,
  agentKey: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{ keyword?: string; limit?: number }>({
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '可选关键词过滤，匹配消息内容含该词的条目',
        },
        limit: {
          type: 'number',
          description: '返回上限，默认 50。过滤后超出上限时取最近 N 条',
        },
      },
    }),
    execute: async ({
      keyword,
      limit = 50,
    }: {
      keyword?: string;
      limit?: number;
    }) => {
      const all = await sessionRepo.getAllMessages(agentKey);

      // 按关键词过滤：JSON.stringify 覆盖嵌套结构(tool call 参数等)
      const filtered = keyword
        ? all.filter((m) => JSON.stringify(m).includes(keyword))
        : all;

      // 取最近 limit 条（保持正序：旧→新）
      const picked = filtered.slice(-limit);

      return toolResult(
        `命中 ${picked.length} 条${keyword ? `（关键词"${keyword}"）` : ''}`,
        JSON.stringify(picked),
        {
          status: 'ok',
          total: filtered.length,
          shown: picked.length,
          hasMore: filtered.length > limit,
        },
      );
    },
  });
}
