import { tool, jsonSchema } from 'ai';
import type { MemoryAgentService } from '../memory/memory-agent.service';
import { toolResult } from './tool-result';

/** 去掉展示里泄漏的 [type]/[id] 方括号 */
function clean(s: string): string {
  return s
    .replace(/\s*\[[^\]]+\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * remember 工具：主 agent 只传一句话，Memory Agent 处理分类、去重、合并。
 */
export function createRememberTool(memoryAgent: MemoryAgentService) {
  return tool({
    description:
      '记住一件值得长期保留的信息。记忆系统会自动判断分类、查找已有记忆、决定新建还是合并。不确定要不要记时，宁可记。',
    inputSchema: jsonSchema<{ content: string }>({
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            '要记住的信息，必须是完整的、脱离对话上下文也能理解的语句',
          examples: [
            '所有者在编辑《量子计算入门》时表示不想用表格展示数据',
            '所有者是数据分析师，关注数据可视化和统计方法',
            '所有者要求回答简洁直接，不要口语化表达',
          ],
        },
      },
      required: ['content'],
      examples: [
        { content: '所有者在编辑《量子计算入门》时表示不想用表格展示数据' },
        { content: '所有者是数据分析师，关注数据可视化和统计方法' },
      ],
    }),
    execute: async ({ content }: { content: string }) => {
      const msg = await memoryAgent.remember(content);
      return toolResult(clean(msg), undefined, { status: 'ok' });
    },
  });
}
