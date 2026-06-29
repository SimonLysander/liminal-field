import { tool, jsonSchema } from 'ai';
import { nanoid } from 'nanoid';
import type { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { toolResult } from './tool-result';

/**
 * write_tasks — 整体改写当前会话的写作计划(Claude Code TodoWrite 式)。
 *
 * 模型每次给出**完整**任务列表,系统用它覆盖原清单 → 模型有最大自由度
 * (增/删/重排/改写/标记进度),且不碰内部 ID、不需要依赖图(顺序即先后)。
 * 当前清单会随 system prompt 注入,模型每轮看得到。
 *
 * 存储:tasks 属于草稿级 agent 工作状态,落在 session 记忆记录(by agentKey),
 * 与对话原文(messages)解耦——onBeforeChat 也从同一处读回注入,保证读写同源。
 */
export const VALID_STATUS = ['pending', 'in_progress', 'done'];

export interface NormalizedTask {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * 规范化任务列表（commit 路径与 execute 路径共用，避免落库逻辑分叉）。
 * - 未知 status 降级为 'pending'
 * - 过滤空 title
 * - 每条生成稳定 id（nanoid 8 位）
 *
 * 返回 Record<string, unknown>[] 对齐 AgentMemoryRepository.setTasks 入参类型。
 */
export function normalizeTasks(
  tasks: Array<{ title: string; status?: string }>,
): Array<Record<string, unknown>> {
  return (tasks ?? [])
    .map((t) => {
      const status = VALID_STATUS.includes(t.status ?? '')
        ? (t.status as string)
        : 'pending';
      return {
        id: nanoid(8),
        title: String(t.title ?? '').trim(),
        status,
        createdAt: new Date().toISOString(),
        completedAt: status === 'done' ? new Date().toISOString() : null,
      };
    })
    .filter((t) => t.title.length > 0);
}

export function createWriteTasksTool(
  memoryRepo: AgentMemoryRepository,
  agentKey: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{
      title?: string;
      tasks: Array<{ title: string; status?: string }>;
    }>({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            '计划的简短标题(几个字概括这份计划在做什么),显示在计划区头部',
        },
        tasks: {
          type: 'array',
          description: '完整的任务列表,按先后顺序排列',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '任务标题' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done'],
                description:
                  '状态(必填):待办 pending / 进行中 in_progress / 完成 done。同一时刻只一个 in_progress',
              },
            },
            required: ['title', 'status'],
          },
        },
      },
      required: ['tasks'],
      examples: [
        {
          title: '打磨这篇散文',
          tasks: [
            { title: '梳理大纲', status: 'done' },
            { title: '补充论据', status: 'in_progress' },
            { title: '通读修改', status: 'pending' },
          ],
        },
      ],
    }),
    execute: async ({
      tasks,
    }: {
      tasks: Array<{ title: string; status?: string }>;
    }) => {
      // 规范化逻辑提取到 normalizeTasks()，commit 路径复用同一函数，行为保持等价
      const norm = normalizeTasks(tasks);

      await memoryRepo.setTasks(agentKey, norm);

      const done = norm.filter((t) => t.status === 'done').length;
      const summary =
        norm.length === 0 ? '已清空计划' : `计划 ${done}/${norm.length}`;
      return toolResult(summary, undefined, {
        status: 'ok',
        total: norm.length,
        done,
      });
    },
  });
}
