import { tool, jsonSchema } from 'ai';
import { nanoid } from 'nanoid';
import type { AgentSessionRepository } from '../session/agent-session.repository';

/**
 * create_task 工具：在当前 session 中创建一个任务。
 */
export function createCreateTaskTool(
  sessionRepo: AgentSessionRepository,
  sessionKey: string,
) {
  return tool({
    description:
      '在当前会话中创建一个任务。适合所有者要求规划写作计划、列出待办事项时使用。',
    parameters: jsonSchema<{
      title: string;
      description?: string;
      blockedBy?: string[];
    }>({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '任务标题',
          examples: ['完成第二章论证', '补充参考文献'],
        },
        description: {
          type: 'string',
          description: '任务详细描述',
          examples: ['需要补充实验数据来支撑量子纠缠的论点'],
        },
        blockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: '依赖的 task ID 列表（这些任务完成后才能开始）',
        },
      },
      required: ['title'],
      examples: [
        { title: '完成第二章论证', description: '需要补充实验数据' },
        {
          title: '全文通读修改',
          blockedBy: ['task_1', 'task_2'],
        },
      ],
    }),
    execute: async ({
      title,
      description,
      blockedBy,
    }: {
      title: string;
      description?: string;
      blockedBy?: string[];
    }) => {
      const task = {
        id: nanoid(8),
        title,
        description: description ?? '',
        status: 'pending',
        blocks: [],
        blockedBy: blockedBy ?? [],
        metadata: {},
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      await sessionRepo.addTask(sessionKey, task);
      return `已创建任务 [${task.id}] ${title}`;
    },
  });
}
