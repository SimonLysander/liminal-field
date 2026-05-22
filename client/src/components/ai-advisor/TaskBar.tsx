/**
 * TaskBar — AI 面板中的任务 checklist。
 *
 * Claude Code 风格：✔ done / ◼ in_progress / ◻ pending
 * 紧凑显示在消息区域上方，不占太多空间。
 */

import type { SessionTask } from '@/services/agent';

const STATUS_ICON: Record<string, string> = {
  done: '✔',
  in_progress: '◼',
  pending: '◻',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--mark-green)',
  in_progress: 'var(--ink)',
  pending: 'var(--ink-ghost)',
};

export function TaskBar({ tasks }: { tasks: SessionTask[] }) {
  if (tasks.length === 0) return null;

  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div
      className="shrink-0 border-b px-4 py-2"
      style={{ borderColor: 'var(--separator)' }}
    >
      {/* 标题行 */}
      <div
        className="mb-1.5 flex items-center gap-2 text-xs font-medium"
        style={{ color: 'var(--ink-faded)' }}
      >
        <span>任务</span>
        <span style={{ color: 'var(--ink-ghost)' }}>
          {doneCount}/{tasks.length}
        </span>
      </div>

      {/* 任务列表 */}
      <div className="space-y-0.5">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-1.5">
            <span
              className="mt-px shrink-0 text-xs leading-relaxed"
              style={{ color: STATUS_COLOR[task.status] }}
            >
              {STATUS_ICON[task.status]}
            </span>
            <span
              className="text-xs leading-relaxed"
              style={{
                color: task.status === 'done' ? 'var(--ink-ghost)' : 'var(--ink-faded)',
                textDecoration: task.status === 'done' ? 'line-through' : 'none',
              }}
            >
              {task.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
