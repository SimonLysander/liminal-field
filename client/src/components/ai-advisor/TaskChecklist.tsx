/**
 * TaskChecklist — 会话写作计划清单(Claude Code TodoWrite 式)。
 *
 * 钉在输入框上方的独立「计划区」(不嵌在对话流里),数据由 use-advisor-chat 从消息流里
 * 最近一次 write_tasks 的 input 实时派生;全部完成即收起。
 * 标记:完成=细勾+删除线(幽墨)· 进行中=长春花紫呼吸点 · 待办=空心圈。紧凑小字,不喧宾夺主。
 */
import { Check } from 'lucide-react';
import type { SessionTask } from '@/services/agent';

function Mark({ status }: { status: string }) {
  // 固定 12px 宽的标记位,三态对齐
  if (status === 'done') {
    return (
      <span className="flex w-3 shrink-0 items-center justify-center">
        <Check size={11} strokeWidth={2.5} style={{ color: 'var(--ink-ghost)' }} />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="flex w-3 shrink-0 items-center justify-center">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '9999px',
            background:
              'radial-gradient(circle, var(--accent) 26%, color-mix(in srgb, var(--accent) 35%, transparent) 62%, transparent 78%)',
            animation: 'mist-breathe 1.8s ease-in-out infinite',
          }}
        />
      </span>
    );
  }
  return (
    <span className="flex w-3 shrink-0 items-center justify-center">
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '9999px',
          border: '1.5px solid var(--ink-ghost)',
        }}
      />
    </span>
  );
}

export function TaskChecklist({
  tasks,
  title,
}: {
  tasks: SessionTask[];
  title?: string;
}) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'done').length;
  // 全部完成 → 收起(执行中已在计划区实时可见,完成即了结,不留残条)
  if (done === tasks.length) return null;

  return (
    <div
      className="flex flex-col gap-0.5 text-xs"
      style={{ fontFamily: 'var(--font-reading)' }}
    >
      <div className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
        {title ? `${title} · ${done}/${tasks.length}` : `计划 ${done}/${tasks.length}`}
      </div>
      {tasks.map((task, i) => (
        <div key={i} className="flex items-center gap-1.5 leading-relaxed">
          <Mark status={task.status} />
          <span
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
  );
}
