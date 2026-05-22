import { tool, jsonSchema } from 'ai';
import type { AgentSessionRepository } from '../session/agent-session.repository';

/**
 * update_task 工具：更新当前 session 中某个任务的状态或内容。
 */
export function createUpdateTaskTool(
  sessionRepo: AgentSessionRepository,
  sessionKey: string,
) {
  return tool({
    description:
      '更新一个已有任务的状态或内容。task_id 从 create_task 的返回值或 session 的 tasks 列表中获取。',
    parameters: jsonSchema<{
      task_id: string;
      status?: 'pending' | 'in_progress' | 'done';
      title?: string;
      description?: string;
    }>({
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: '要更新的任务 ID',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done'],
          description: '新状态',
        },
        title: {
          type: 'string',
          description: '新标题',
        },
        description: {
          type: 'string',
          description: '新描述',
        },
      },
      required: ['task_id'],
      examples: [
        { task_id: 'abc12345', status: 'done' },
        {
          task_id: 'abc12345',
          status: 'in_progress',
          description: '已开始写第二章',
        },
      ],
    }),
    execute: async ({
      task_id,
      status,
      title,
      description,
    }: {
      task_id: string;
      status?: string;
      title?: string;
      description?: string;
    }) => {
      const updates: Record<string, unknown> = {};
      if (status) {
        updates.status = status;
        if (status === 'done') updates.completedAt = new Date().toISOString();
      }
      if (title) updates.title = title;
      if (description) updates.description = description;

      if (Object.keys(updates).length === 0) {
        return '没有提供要更新的字段';
      }

      await sessionRepo.updateTask(sessionKey, task_id, updates);

      const parts = [];
      if (status) parts.push(`状态→${status}`);
      if (title) parts.push(`标题→${title}`);
      return `已更新任务 [${task_id}] ${parts.join(', ')}`;
    },
  });
}
