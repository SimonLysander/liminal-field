import { tool, jsonSchema } from 'ai';
import type { SubAgentService } from '../sub-agent/sub-agent.service';
import type { DocumentContext } from './get-current-document.tool';

/**
 * sub_agent 工具：主 agent 委派明确任务给独立的子 agent。
 *
 * 子 agent 有独立的 context window + 只读工具集，
 * 完成后只返回结论，中间过程不污染主对话。
 */
export function createSubAgentTool(
  subAgentService: SubAgentService,
  document: DocumentContext | undefined,
  tier?: string,
  sessionKey?: string,
) {
  return tool({
    description:
      '把一个明确的任务委派给独立的子 agent。子 agent 有独立上下文和工具，完成后只返回结论，当前对话不会被中间过程干扰。适合需要搜索+读多篇+综合分析的任务。',
    inputSchema: jsonSchema<{
      task: string;
      title: string;
      max_steps?: number;
    }>({
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            '明确的、可完成的任务描述。先自己理解问题，再委派具体子任务。',
          examples: [
            '搜索知识库中所有关于量子计算的内容，读取正文，分析各篇核心观点和重叠部分',
            '找到所有者之前写的数据可视化相关笔记，总结主要方法论',
          ],
        },
        title: {
          type: 'string',
          description:
            '【必填】几个字的短标题,概括委派的是什么,显示在 Delegate 行,如「分析排序笔记」「梳理量子计算」。不要照抄 task,提炼成几个字。',
        },
        max_steps: {
          type: 'number',
          description: '最大推理步数，默认 12',
        },
      },
      required: ['task', 'title'],
      examples: [
        {
          title: '分析量子计算笔记',
          task: '搜索知识库中所有关于量子计算的内容，读取正文，分析各篇核心观点和重叠部分',
        },
      ],
    }),
    execute: async ({
      task,
      max_steps,
    }: {
      task: string;
      title?: string;
      max_steps?: number;
    }) => {
      return subAgentService.execute({
        task,
        document,
        maxSteps: max_steps,
        tier,
        sessionKey,
      });
    },
  });
}
