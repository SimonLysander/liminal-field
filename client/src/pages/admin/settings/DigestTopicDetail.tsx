/**
 * DigestTopicDetail — 智能采集事项详情页（/admin/digest/:id）。
 *
 * 展示：
 *   - 事项基本信息（名称、描述、运行节奏）
 *   - 「最近运行」section：最近 5 次 task 行 + 展开时间线（agent 调用链）
 *   - 「立即运行」按钮
 *
 * 数据：
 *   - topicsApi.get(:id) — 事项详情（名称/cron/启用状态）
 *   - digestTasksApi.listByTopic(:id) — 最近 5 次 task（不含 steps 全文）
 *   - digestTasksApi.get(:taskId) — 展开时按需拉 steps（懒加载）
 *   - digestTasksApi.runNow(:id) — 立即触发
 *
 * 设计风格：与 ToolCallCard（Aurora advisor）风格对齐，左竖线时间线。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Inbox,
  Search,
  FileText,
  Star,
  Play,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { topicsApi, digestTasksApi } from '@/services/topics';
import type { TopicDetail, DigestTaskListItem, AgentStep } from '@/services/topics';
import { humanizeCron } from './scheduleUtils';

// ── 工具函数 ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** args 展示：简短字符串，长值截断 */
function formatArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const val = typeof v === 'string'
      ? (v.length > 30 ? `${v.slice(0, 30)}…` : v)
      : String(v);
    return `${k}:${val}`;
  });
  return parts.length ? `{${parts.join(', ')}}` : '{}';
}

// ── 工具图标 ──────────────────────────────────────────────────────────────────

/** browse / web_search / web_fetch / pick 对应的 lucide 图标 */
const TOOL_ICON: Record<string, LucideIcon> = {
  browse: Inbox,
  web_search: Search,
  web_fetch: FileText,
  pick: Star,
};

// ── 状态 badge ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DigestTaskListItem['status'] }) {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    running: { bg: 'var(--accent)', text: '#fff', label: '运行中' },
    done: { bg: 'var(--success, #22c55e)', text: '#fff', label: '完成' },
    failed: { bg: 'var(--danger, #ef4444)', text: '#fff', label: '失败' },
  };
  const c = colors[status] ?? { bg: 'var(--separator)', text: 'var(--ink)', label: status };
  return (
    <span
      className="rounded px-1.5 py-0.5 text-2xs font-medium"
      style={{ background: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  );
}

// ── AgentStep 时间线 ──────────────────────────────────────────────────────────

/**
 * StepTimeline — agent 调用链时间线展示。
 * 设计：左竖线 + 工具图标 + 工具名 {args} · summary · meta 摘要
 * 与 ToolCallCard 视觉语言一致。
 */
function StepTimeline({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-ghost)' }}>
        暂无调用步骤
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-0">
      {steps.map((step, idx) => {
        const Icon = TOOL_ICON[step.toolName] ?? Wrench;
        const isError = !!step.error;
        // meta 里有数值类聚合（totalFetched/afterDedupe/saved...），取前 3 个显示
        const metaSummary = step.meta
          ? Object.entries(step.meta)
              .filter(([, v]) => typeof v === 'number')
              .slice(0, 3)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')
          : '';

        return (
          <div
            key={idx}
            className="flex items-start gap-2 border-l-2 pl-3 py-1"
            style={{ borderColor: 'var(--separator)', fontFamily: 'var(--font-mono, monospace)' }}
          >
            {/* 时间戳 */}
            <span
              className="shrink-0 text-2xs tabular-nums"
              style={{ color: 'var(--ink-ghost)', minWidth: '6rem' }}
            >
              {formatTime(step.ts)}
            </span>

            {/* 图标 */}
            <Icon
              size={13}
              strokeWidth={2}
              className="mt-0.5 shrink-0"
              style={{ color: isError ? 'var(--danger, #ef4444)' : 'var(--ink-faded)' }}
            />

            {/* 工具名 + args + summary */}
            <div className="min-w-0 flex-1 text-xs" style={{ fontFamily: 'inherit' }}>
              <span className="font-medium" style={{ color: 'var(--ink)' }}>
                {step.toolName}
              </span>
              <span className="ml-1" style={{ color: 'var(--ink-ghost)' }}>
                {formatArgs(step.args)}
              </span>
              {step.summary && (
                <span className="ml-1" style={{ color: isError ? 'var(--danger, #ef4444)' : 'var(--ink-faded)' }}>
                  · {step.summary}
                </span>
              )}
              {metaSummary && (
                <span className="ml-1 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                  · {metaSummary}
                </span>
              )}
              {step.error && (
                <span className="ml-1 text-2xs" style={{ color: 'var(--danger, #ef4444)' }}>
                  [{step.error}]
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

/**
 * TaskRow — 单次运行记录行。
 * 展开时懒加载 steps（GET /digest/tasks/:id）。
 */
function TaskRow({
  task,
  expanded,
  onToggleExpand,
}: {
  task: DigestTaskListItem;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [steps, setSteps] = useState<AgentStep[] | null>(null);
  const [loadingSteps, setLoadingSteps] = useState(false);

  // 展开时拉 steps（只拉一次）
  useEffect(() => {
    if (!expanded || steps !== null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 懒加载触发时需同步设置 loading 状态
    setLoadingSteps(true);
    digestTasksApi
      .get(task.id)
      .then((detail) => setSteps(detail.steps))
      .catch(() => setSteps([]))
      .finally(() => setLoadingSteps(false));
  }, [expanded, steps, task.id]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {/* 主行 */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 时间 */}
        <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>
          {formatRelativeTime(task.startedAt)}
        </span>

        {/* 状态 */}
        <StatusBadge status={task.status} />

        {/* 统计 */}
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {task.stepsCount} 步 · {task.findingsCount} 条
        </span>

        {/* 失败错误 */}
        {task.error && (
          <span
            className="truncate text-2xs"
            style={{ color: 'var(--danger, #ef4444)', maxWidth: '12rem' }}
            title={task.error}
          >
            {task.error}
          </span>
        )}

        <div className="flex-1" />

        {/* 展开/收起按钮（只有有 steps 时才显示） */}
        {task.stepsCount > 0 && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1 rounded px-2 py-1 text-2xs transition-colors hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-faded)' }}
          >
            {expanded ? (
              <>
                <ChevronUp size={12} />
                收起
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                查看调用链
              </>
            )}
          </button>
        )}
      </div>

      {/* 展开：时间线 */}
      {expanded && (
        <div
          className="border-t px-4 pb-3 pt-2"
          style={{ borderColor: 'var(--separator)' }}
        >
          {loadingSteps ? (
            <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              加载中…
            </p>
          ) : (
            <StepTimeline steps={steps ?? []} />
          )}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function DigestTopicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [tasks, setTasks] = useState<DigestTaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [topicData, taskList] = await Promise.all([
        topicsApi.get(id),
        digestTasksApi.listByTopic(id, 5),
      ]);
      setTopic(topicData);
      setTasks(taskList);
    } catch {
      banner.error('加载事项详情失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const handleRunNow = async () => {
    if (!id) return;
    setRunning(true);
    try {
      await digestTasksApi.runNow(id);
      banner.success('已触发运行');
      // 稍等片刻再刷新任务列表（task 刚建出来是 running）
      await new Promise((r) => setTimeout(r, 500));
      await loadData();
    } catch {
      banner.error('触发失败');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          加载中…
        </span>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs" style={{ color: 'var(--danger, #ef4444)' }}>
          事项不存在
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
      {/* Topbar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
        style={{ borderColor: 'var(--separator)' }}
      >
        <button
          type="button"
          onClick={() => navigate('/admin/settings/digest')}
          className="rounded p-1.5 transition-colors hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-faded)' }}
          aria-label="返回事项列表"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
            {topic.name}
          </h1>
          <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {topic.cron} · {topic.sourceIds.length} 个信息源
            {!topic.enabled && (
              <span className="ml-2" style={{ color: 'var(--ink-ghost)' }}>（已停用）</span>
            )}
          </p>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl space-y-6">
          {/* 事项配置 section（只读展示，编辑走列表的 ✏️ 按钮） */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              事项配置
            </h2>
            <div className="space-y-2">
              {/* 任务描述（用户最关心的） */}
              {topic.prompt && (
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>任务描述</div>
                  <p
                    className="mt-1 whitespace-pre-wrap text-sm"
                    style={{ color: 'var(--ink)' }}
                  >
                    {topic.prompt}
                  </p>
                </div>
              )}

              {/* 节奏 + 最大轮次 一行展示 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>运行节奏</div>
                  <p className="mt-1 text-sm" style={{ color: 'var(--ink)' }}>
                    {humanizeCron(topic.cron)}
                  </p>
                </div>
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>Agent 最大轮次</div>
                  <p className="mt-1 text-sm" style={{ color: 'var(--ink)' }}>
                    {topic.maxSteps ?? 20} 轮
                  </p>
                </div>
              </div>

              {/* 订阅信息源（chip 只读，不带删除按钮） */}
              {topic.sources.length > 0 && (
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
                    订阅信息源（{topic.sources.length}）
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {topic.sources.map((s) => (
                      <span
                        key={s.id}
                        className="rounded px-2 py-0.5 text-xs"
                        style={{
                          background: 'var(--shelf)',
                          color: 'var(--ink-soft)',
                          border: '0.5px solid var(--separator)',
                        }}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 最近运行 section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                最近运行
              </h2>
              <button
                type="button"
                onClick={() => void handleRunNow()}
                disabled={running}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                }}
              >
                <Play size={12} strokeWidth={2} />
                {running ? '运行中…' : '立即运行'}
              </button>
            </div>

            {tasks.length === 0 ? (
              <div
                className="rounded-lg px-4 py-6 text-center text-xs"
                style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
              >
                暂无运行记录，点「立即运行」触发第一次采集。
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    expanded={expandedId === task.id}
                    onToggleExpand={() =>
                      setExpandedId(expandedId === task.id ? null : task.id)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default DigestTopicDetail;
