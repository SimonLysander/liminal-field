import { tool, jsonSchema } from 'ai';
import { nanoid } from 'nanoid';
import type { AgentSessionRepository } from '../session/agent-session.repository';
import { toolResult } from './tool-result';

/**
 * write_tasks — 整体改写当前会话的写作计划(Claude Code TodoWrite 式)。
 *
 * 模型每次给出**完整**任务列表,系统用它覆盖原清单 → 模型有最大自由度
 * (增/删/重排/改写/标记进度),且不碰内部 ID、不需要依赖图(顺序即先后)。
 * 当前清单会随 system prompt 注入,模型每轮看得到。
 */
const VALID_STATUS = ['pending', 'in_progress', 'done'];

export function createWriteTasksTool(
  sessionRepo: AgentSessionRepository,
  sessionKey: string,
) {
  return tool({
    description:
      '改写当前会话的写作计划清单(整体替换:给出**完整**列表覆盖原清单)。用于规划、增删、调整顺序、标记进度。当前清单已在 system prompt 的 <tasks> 中。\n纪律(逼你想清楚,别偷懒):① 每个任务都必须给 status;② **同一时刻只能有一个 in_progress**(你当前正在做的那个),其余是 pending 或 done;③ 用列表顺序表达先后,不需要依赖字段;④ 每推进一步就调用本工具更新,让计划始终反映真实进度;⑤ **全部做完、或计划作废时,传空列表 `[]` 清空**(否则这份计划会一直留在你的上下文里);⑥ 给这份计划起个简短的 title(如「研究排序笔记」「重构开篇」),显示在计划区头部。',
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
      const norm = (tasks ?? [])
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

      await sessionRepo.setTasks(sessionKey, norm);

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
