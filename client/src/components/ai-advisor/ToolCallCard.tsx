/**
 * ToolCallCard — 两行式工具调用展示。
 *
 * 第一行：· ToolName(关键信息)
 * 第二行：  结果摘要
 *
 * sub_agent 特殊处理：执行中通过 SSE 实时接收步骤，
 * Claude Code 风格嵌套展示每步的工具调用。
 */

import { useEffect, useRef, useState } from 'react';

interface ToolCallCardProps {
  toolName: string;
  state: 'call' | 'result' | 'error';
  args: unknown;
  result?: string;
  /** sub_agent 实时进度需要 sessionKey 连接 SSE */
  sessionKey?: string;
}

const DISPLAY_NAMES: Record<string, string> = {
  search_knowledge_base: 'Search',
  read_document_content: 'Read',
  get_current_draft: 'Read Draft',
  remember: 'Write Memory',
  forget: 'Delete Memory',
  sub_agent: 'Delegate',
  create_task: 'New Task',
  update_task: 'Update Task',
};

/** sub_agent 步骤的显示名称映射 */
const STEP_DISPLAY: Record<string, string> = {
  search_knowledge_base: 'Search',
  read_document_content: 'Read',
  get_current_draft: 'Read Draft',
};

interface StepTool {
  name: string;
  args: string;
}

// ── 工具函数 ──────────────────────────────────────────────

function extractInfo(args: unknown, result: string | undefined): string {
  const a =
    args != null && typeof args === 'object'
      ? (args as Record<string, unknown>)
      : {};

  if (result) {
    try {
      const p = JSON.parse(result) as Record<string, unknown>;
      if (typeof p.title === 'string') return truncate(p.title, 20);
    } catch { /* not JSON */ }
  }

  for (const key of ['query', 'title', 'content', 'task', 'target']) {
    if (typeof a[key] === 'string') return truncate(a[key] as string, 20);
  }

  return '';
}

function extractSummary(result: string): string {
  try {
    const p = JSON.parse(result) as Record<string, unknown>;
    if (typeof p.conclusion === 'string')
      return truncate(p.conclusion.split('\n')[0], 50);
    const parts: string[] = [];
    if (typeof p.wordCount === 'number')
      parts.push(`${(p.wordCount as number).toLocaleString()}字`);
    if (typeof p.paragraphs === 'number') parts.push(`${p.paragraphs}段`);
    if (Array.isArray(p.outline) && p.outline.length > 0)
      parts.push(`${p.outline.length} 章节`);
    if (parts.length > 0) return parts.join(' · ');
  } catch { /* not JSON */ }

  const countMatch = result.match(/共 (\d+) 条结果/);
  if (countMatch) {
    const titles = result
      .split('\n')
      .filter((l) => l.startsWith('['))
      .map((l) => l.replace(/^\[\w+\]\s*/, '').replace(/\s*\(.*$/, ''))
      .slice(0, 3);
    const suffix = parseInt(countMatch[1]) > 3 ? '...' : '';
    return `${countMatch[1]} 条结果: ${titles.join(', ')}${suffix}`;
  }

  if (/^(已记住|已忘记|已创建|已更新)/.test(result))
    return truncate(result, 40);
  if (result.includes('失败') || result.includes('错误') || result.includes('Error'))
    return truncate(result, 40);

  return truncate(result.split('\n')[0], 40);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 从完成后的 JSON 结果中解析步骤 */
function parseSubAgentSteps(result: string): StepTool[] | null {
  try {
    const p = JSON.parse(result) as {
      steps?: Array<{ tools: StepTool[] }>;
    };
    if (!p.steps?.length) return null;
    return p.steps.flatMap((s) => s.tools);
  } catch {
    return null;
  }
}

// ── 嵌套步骤列表 ──────────────────────────────────────────

function StepList({ steps }: { steps: StepTool[] }) {
  if (steps.length === 0) return null;
  // 去重：typed 和 static 可能重复同一个调用
  const seen = new Set<string>();
  const unique = steps.filter((s) => {
    const key = `${s.name}:${s.args}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const visible = unique.slice(0, 8);
  const remaining = unique.length - visible.length;

  return (
    <div className="mt-0.5 pl-4" style={{ color: 'var(--ink-ghost)' }}>
      {visible.map((s, i) => (
        <div key={i} className="truncate">
          <span className="mr-1">{i === 0 ? '⎿' : ' '}</span>
          <span style={{ color: 'var(--ink-faded)' }}>
            {STEP_DISPLAY[s.name] ?? s.name}
          </span>
          {s.args && (
            <span style={{ color: 'var(--ink-ghost)' }}>({s.args})</span>
          )}
        </div>
      ))}
      {remaining > 0 && (
        <div className="pl-3">+{remaining} more</div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────

export function ToolCallCard({
  toolName,
  state,
  args,
  result,
  sessionKey,
}: ToolCallCardProps) {
  const name = DISPLAY_NAMES[toolName] ?? toolName;
  const info = extractInfo(args, result);

  // ── sub_agent 实时进度：SSE 连接 ──
  const [liveSteps, setLiveSteps] = useState<StepTool[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 仅 sub_agent 执行中 + 有 sessionKey 时连接 SSE
    if (toolName !== 'sub_agent' || state !== 'call' || !sessionKey) return;

    const es = new EventSource(
      `/api/v1/agent/sub-agent-progress?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        let raw = JSON.parse(event.data);
        // NestJS @Sse() + Fastify 可能双层包装：{ data: "{...}" }
        if (typeof raw === 'object' && typeof raw.data === 'string') {
          raw = JSON.parse(raw.data);
        }
        const data = raw as { type: 'step' | 'done'; tools?: StepTool[] };
        if (data.type === 'step' && data.tools) {
          setLiveSteps((prev) => [...prev, ...data.tools!]);
        } else if (data.type === 'done') {
          es.close();
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [toolName, state, sessionKey]);

  // 完成后从 result 解析步骤（SSE 断了也能回退到这个）
  const finalSteps =
    state === 'result' && result ? parseSubAgentSteps(result) : null;

  // 优先用完成后的完整步骤，执行中用实时步骤
  const displaySteps = finalSteps ?? (liveSteps.length > 0 ? liveSteps : null);

  // 颜色：灰=只读常规，绿=写入/变更成功，红=失败
  const isWriteOp = ['remember', 'forget', 'create_task', 'update_task'].includes(toolName);

  let dotColor: string;
  if (state === 'error') {
    dotColor = 'var(--mark-red, #ff3b30)';
  } else if (state === 'result' && isWriteOp) {
    dotColor = 'var(--mark-green, #30d158)';
  } else {
    dotColor = 'var(--ink-ghost)';
  }

  return (
    <div className="my-0.5 text-sm" style={{ lineHeight: 1.6 }}>
      {/* 第一行：状态点 + 工具名 + 关键信息 */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="mt-px inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: dotColor,
            ...(state === 'call'
              ? { animation: 'pulse 1.5s ease-in-out infinite' }
              : {}),
          }}
        />
        <span style={{ color: 'var(--ink-faded)' }}>
          {name}
          {info && (
            <span style={{ color: 'var(--ink-ghost)' }}>({info})</span>
          )}
        </span>
      </div>

      {/* sub_agent 嵌套步骤（实时 + 完成后） */}
      {toolName === 'sub_agent' && displaySteps && (
        <StepList steps={displaySteps} />
      )}

      {/* 结果摘要 */}
      {state !== 'call' && result && (
        <div className="pl-4" style={{ color: 'var(--ink-ghost)' }}>
          {extractSummary(result)}
        </div>
      )}
    </div>
  );
}
