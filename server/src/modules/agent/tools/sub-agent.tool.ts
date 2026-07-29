import { tool, jsonSchema } from 'ai';
import type { SubAgentService } from '../sub-agent/sub-agent.service';
import type { SubAgentParentContext } from '../sub-agent/sub-agent-context';

/**
 * sub_agent 工具：主 agent 把研究焦点交给独立的子 agent。
 *
 * 子 agent 自动继承必要上下文，并以独立 context window 和只读工具集工作；
 * 完成后返回完整研究报告，中间过程不污染主对话。
 */
export function createSubAgentTool(
  subAgentService: SubAgentService,
  parentContext: SubAgentParentContext,
  tier?: string,
  sessionKey?: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
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
            '本轮优先研究的焦点及希望获得的依据。系统会自动附带当前用户请求、近期对话和业务场景，不必重复全部背景。',
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
        parentContext,
        maxSteps: max_steps,
        tier,
        sessionKey,
      });
    },
  });
}
