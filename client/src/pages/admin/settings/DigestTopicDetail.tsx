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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  ExternalLink,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { topicsApi, digestTasksApi } from '@/services/topics';
import type { TopicDetail, DigestTaskListItem, AgentStep } from '@/services/topics';
import { structureApi } from '@/services/structure';
import { useConfirm } from '@/contexts/ConfirmContext';
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
 * task done 且产出了 report 时,行末显示"查看 ↗"+ "删除 🗑"——把"管理产物"
 * 落在 task 本身的位置(而不是单独再做一个"已发布报告"列表),避免数据双源。
 */
function TaskRow({
  task,
  topicId,
  expanded,
  onToggleExpand,
  onDeleteReport,
}: {
  task: DigestTaskListItem;
  topicId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  /** task done 且 reportContentItemId 非空时点击删除产物 */
  onDeleteReport?: (task: DigestTaskListItem) => void;
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

        {/* 产物操作:只在 task done + reportContentItemId 非空时显示 */}
        {task.status === 'done' && task.reportContentItemId && (
          <div className="flex items-center gap-0.5">
            <a
              href={`/digest/${topicId}/${task.reportContentItemId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="在新标签打开报告"
              className="flex items-center gap-1 rounded px-2 py-1 text-2xs transition-colors hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              <ExternalLink size={12} strokeWidth={1.75} />
              <span>查看</span>
            </a>
            {onDeleteReport && (
              <button
                type="button"
                onClick={() => onDeleteReport(task)}
                title="删除这一期报告(不可恢复)"
                className="flex items-center gap-1 rounded px-2 py-1 text-2xs transition-colors hover:bg-[var(--shelf)]"
                style={{ color: 'var(--ink-faded)' }}
              >
                <Trash2 size={12} strokeWidth={1.75} />
                <span>删除</span>
              </button>
            )}
          </div>
        )}

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
  const confirm = useConfirm();

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [tasks, setTasks] = useState<DigestTaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 限多拉一些(20),让用户能看完整本月历史;早期版本只拉 5,新页面右栏空间多 */
  const TASKS_LIMIT = 20;

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [topicData, taskList] = await Promise.all([
        topicsApi.get(id),
        digestTasksApi.listByTopic(id, TASKS_LIMIT),
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

  /**
   * 自动 poll:有 running task 时每 4s 轻刷,直到所有 task 都不 running。
   * 设计:之前页面只在打开时拉一次,导致截图里"运行中 0 步"永远 0(看到的
   * 是 snapshot 不是 live)。现在 running 期间持续刷,体验跟"立即运行"按钮
   * 形成闭环——点了能看到步数往上加。
   */
  const hasRunning = tasks.some((t) => t.status === 'running');
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => {
      void loadDataRef.current();
    }, 4000);
    return () => clearInterval(timer);
  }, [hasRunning]);

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

  /**
   * 删除一期报告 = 删 ContentItem(走通用 structureApi.deleteNode)。
   * task 记录里 reportContentItemId 不动(留作历史孤儿引用,公开端 listReports
   * 基于 NavNode 子节点,删 NavNode 后自然就不出现)。
   * 不弹"删除调试日志/task 记录"——那是 audit trail,只删产物。
   */
  const handleDeleteReport = useCallback(
    async (task: DigestTaskListItem) => {
      if (!task.reportContentItemId) return;
      const ok = await confirm({
        title: '删了这一期报告？',
        message: (
          <>
            <p>
              删除后报告页就打不开了——
              <strong>已经发过的 newsletter 订阅 / 外链都会变成 404</strong>。
            </p>
            <p className="mt-2" style={{ color: 'var(--ink-faded)' }}>
              运行记录会保留(包括步骤、findings 摘要),只是失去了那篇正文。
            </p>
          </>
        ),
        confirmLabel: '确认删除',
        cancelLabel: '再想想',
        danger: true,
      });
      if (!ok) return;
      try {
        await structureApi.deleteNode(task.reportContentItemId);
        banner.success('已删除');
        await loadData();
      } catch {
        banner.error('没能删掉，再试一次？');
      }
    },
    [confirm, loadData],
  );

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

      {/* 内容区:双栏(响应式:窄屏 < 1024px 单栏)。
          左栏 (24rem) 事项配置(只读,改走列表 ✎);右栏 flex-1 产物/运行管理。
          以前是单栏 max-w-2xl,右侧整片空白浪费 viewport;现在右栏承担"管理报告"主作业面。 */}
      <div className="flex-1 overflow-hidden">
        <div className="grid h-full grid-cols-1 lg:grid-cols-[24rem_minmax(0,1fr)]">
          {/* ── 左栏:事项配置 ── */}
          <aside
            className="overflow-y-auto px-6 py-6 lg:border-r"
            style={{ borderColor: 'var(--separator)' }}
          >
            <h2 className="mb-4 text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--ink-ghost)' }}>
              事项配置
            </h2>
            <div className="space-y-4">
              {topic.prompt && (
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>任务描述</div>
                  <p
                    className="mt-1 whitespace-pre-wrap text-sm leading-relaxed"
                    style={{ color: 'var(--ink)' }}
                  >
                    {topic.prompt}
                  </p>
                </div>
              )}

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

              {topic.sources.length > 0 && (
                <div>
                  <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
                    订阅信息源（{topic.sources.length}）
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
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
          </aside>

          {/* ── 右栏:期刊产物 + 运行管理 ── */}
          <main className="overflow-y-auto px-6 py-6">
            {/* 顶栏:页面级"立即运行"按钮 + 自动 poll 提示 */}
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-baseline gap-3">
                <h2 className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--ink-ghost)' }}>
                  运行历史 &amp; 期刊产物
                </h2>
                {hasRunning && (
                  <span className="text-xs italic" style={{ color: 'var(--accent)' }}>
                    凝思中…
                  </span>
                )}
              </div>
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
                className="rounded-lg px-4 py-12 text-center text-xs"
                style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
              >
                还没跑过——点「立即运行」试试第一期。
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    topicId={id ?? ''}
                    expanded={expandedId === task.id}
                    onToggleExpand={() =>
                      setExpandedId(expandedId === task.id ? null : task.id)
                    }
                    onDeleteReport={handleDeleteReport}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default DigestTopicDetail;
