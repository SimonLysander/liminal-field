/**
 * ToolCallCard — 一行式工具调用展示:图标 + 工具名 · 「做了什么 + 结果统计」。
 *
 * 「碰了一组东西」的工具(search 命中 / list 构成)在下面挂一段结果反馈(NestedList,⎿ 对齐、截断)。
 * sub_agent(Delegate)展开内部每一步:每步也是「工具 + 该步反馈统计」一行(执行中走 SSE 实时追加)。
 */

import { useEffect, useRef, useState } from 'react';
import {
  Search,
  List,
  BookOpen,
  FileText,
  Bookmark,
  BookmarkMinus,
  Workflow,
  Wrench,
  PencilLine,
  type LucideIcon,
} from 'lucide-react';

interface ToolCallCardProps {
  toolName: string;
  state: 'call' | 'result' | 'error';
  result?: string;
  /** 工具入参 —— sub_agent 用它取委派任务(执行中就能显示参数,不光秃) */
  args?: unknown;
  /** sub_agent 执行中实时步骤需要 sessionKey 连接 SSE */
  sessionKey?: string;
}

// 工具显示名沿用英文(与后端函数名一致,Claude Code 风)
const DISPLAY_NAMES: Record<string, string> = {
  search_knowledge_base: 'Search',
  list_knowledge_base: 'List',
  read_document_content: 'Read',
  get_current_draft: 'Read Current Draft',
  remember: 'Write Memory',
  forget: 'Delete Memory',
  // #150(2026-05-31):recall = 按标题精读单条;search = 模糊搜候选
  recall_memory: 'Read Memory',
  search_memories: 'Search Memory',
  sub_agent: 'Delegate',
  propose_edit: '提议修改',
  // v3 改稿工具:生成完整改稿方案,等待编辑器审批
  propose_document_rewrite: '生成改稿',
};

/** 每个工具的 lucide 图标(纸墨批注的辨识符) */
const TOOL_ICON: Record<string, LucideIcon> = {
  search_knowledge_base: Search,
  list_knowledge_base: List,
  read_document_content: BookOpen,
  get_current_draft: FileText,
  remember: Bookmark,
  forget: BookmarkMinus,
  // #150:recall 按标题读 = 翻开书签那条(BookOpen 同 read 系);search 模糊搜 = Search
  recall_memory: BookOpen,
  search_memories: Search,
  sub_agent: Workflow,
  propose_edit: PencilLine,
  // v3 改稿工具:与 propose_edit 同图标规格(PencilLine size=13, strokeWidth=2)
  propose_document_rewrite: PencilLine,
};

// ── 工具函数 ──────────────────────────────────────────────


/** 解析统一契约 ToolResult(见 server tool-result.ts);旧格式回退到首行。 */
interface ParsedResult {
  summary: string;
  status?: string;
  hasMore?: boolean;
  /** 下面那点"结果反馈"(命中篇目/库内条目等),NestedList 渲染 */
  list?: string[];
}
function parseToolResult(result: string): ParsedResult {
  try {
    const p = JSON.parse(result) as Record<string, unknown>;
    // 新契约:{ summary, detail, meta }
    if (typeof p.summary === 'string') {
      const meta = (p.meta ?? {}) as {
        status?: string;
        hasMore?: boolean;
        list?: string[];
      };
      return {
        summary: p.summary,
        status: meta.status,
        hasMore: meta.hasMore,
        list: Array.isArray(meta.list) ? meta.list : undefined,
      };
    }
    // 旧 read 画像 { title, wordCount, outline }
    if (typeof p.title === 'string') {
      const bits = [p.title as string];
      if (typeof p.wordCount === 'number')
        bits.push(`${(p.wordCount as number).toLocaleString()} 字`);
      if (Array.isArray(p.outline) && p.outline.length > 0)
        bits.push(`${p.outline.length} 章节`);
      return { summary: bits.join(' · ') };
    }
    // 旧 sub_agent { conclusion, steps, stats } —— 不 dump 结论,从 stats 重建状态
    if (typeof p.conclusion === 'string') {
      const stats = p.stats as { stepsUsed?: number } | undefined;
      return { summary: stats?.stepsUsed ? `完成 · ${stats.stepsUsed} 步` : '完成' };
    }
  } catch {
    /* 非 JSON,按纯文本处理 */
  }

  // 旧纯文本:首行,去掉泄漏的方括号
  return {
    summary: result
      .split('\n')[0]
      .replace(/\s*\[[^\]]+\]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  };
}

// ── sub_agent 步骤 ────────────────────────────────────────

/** 子 agent 的一步:工具名 + 该步的反馈统计(= 该工具结果的 summary) */
interface StepTool {
  name: string;
  summary: string;
}

/** 从结果里解析子 agent 步骤(契约在 meta.steps,每个 step 含多次 tool 调用)。 */
function parseSubAgentSteps(result: string): StepTool[] | null {
  try {
    const p = JSON.parse(result) as {
      meta?: { steps?: Array<{ tools: StepTool[] }> };
    };
    const steps = p.meta?.steps;
    if (!steps?.length) return null;
    return steps.flatMap((s) => s.tools);
  } catch {
    return null;
  }
}

// ── 结果反馈列表 ──────────────────────────────────────────

/**
 * NestedList — "下面那点结果反馈"的统一渲染:首行 ⎿ 连接符 + 固定宽前缀,所有行文字对齐;
 * 最多 5 行,超出显示"还有 N 个"。search 命中 / list 构成 / sub_agent 步骤共用。
 */
function NestedList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const visible = items.slice(0, 5);
  const remaining = items.length - visible.length;
  return (
    <div className="mt-0.5 pl-5">
      {visible.map((it, i) => (
        <div key={i} className="flex items-baseline">
          <span className="w-4 shrink-0" style={{ color: 'var(--ink-ghost)' }}>
            {i === 0 ? '⎿' : ''}
          </span>
          <span className="truncate" style={{ color: 'var(--ink-faded)' }}>
            {it}
          </span>
        </div>
      ))}
      {remaining > 0 && (
        <div className="flex items-baseline" style={{ color: 'var(--ink-ghost)' }}>
          <span className="w-4 shrink-0" />
          <span>还有 {remaining} 个</span>
        </div>
      )}
    </div>
  );
}

/** 子 agent 步骤列表:每步 = 工具 + 该步反馈统计,一行;交给 NestedList(⎿ 对齐、截断)。 */
function StepList({ steps }: { steps: StepTool[] }) {
  if (steps.length === 0) return null;
  const seen = new Set<string>();
  const items = steps
    .map(
      (s) =>
        `${DISPLAY_NAMES[s.name] ?? s.name}${s.summary ? ` · ${s.summary}` : ''}`,
    )
    .filter((it) => (seen.has(it) ? false : (seen.add(it), true)));
  return <NestedList items={items} />;
}

// ── 主组件 ────────────────────────────────────────────────

export function ToolCallCard({
  toolName,
  state,
  result,
  args,
  sessionKey,
}: ToolCallCardProps) {
  const name = DISPLAY_NAMES[toolName] ?? toolName;
  // sub_agent 的"参数"= 委派任务的短标题(模型给的 title;没有就截断 task),执行中也显示,不光秃
  const subLabel =
    toolName === 'sub_agent'
      ? (() => {
          const a = args as { title?: string; task?: string } | undefined;
          const t = a?.title || a?.task || '';
          return t.length > 22 ? `${t.slice(0, 22)}…` : t;
        })()
      : '';

  // ── sub_agent 执行中:SSE 实时接收每一步(断了/刷新则回退到结果里的 meta.steps) ──
  const [liveSteps, setLiveSteps] = useState<StepTool[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (toolName !== 'sub_agent' || state !== 'call' || !sessionKey) return;

    const es = new EventSource(
      `/api/v1/agent/sub-agent-progress?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        let raw = JSON.parse(event.data);
        // NestJS @Sse() + Fastify 可能双层包装:{ data: "{...}" }
        if (typeof raw === 'object' && typeof raw.data === 'string') {
          raw = JSON.parse(raw.data);
        }
        const data = raw as { type: 'step' | 'done'; tools?: StepTool[] };
        if (data.type === 'step' && data.tools) {
          setLiveSteps((prev) => [...prev, ...data.tools!]);
        } else if (data.type === 'done') {
          es.close();
        }
      } catch {
        /* 忽略解析错误 */
      }
    };
    es.onerror = () => es.close();

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [toolName, state, sessionKey]);

  // 完成后从 result 的 meta.steps 取完整步骤;执行中用 SSE 实时步骤
  const finalSteps =
    state === 'result' && result ? parseSubAgentSteps(result) : null;
  const displaySteps = finalSteps ?? (liveSteps.length > 0 ? liveSteps : null);

  // 状态点配色(宪法 token,不用 iOS 系统色):
  // 进行中=accent 脉动(§3 进行中=accent 脉动点)· 失败=danger · 写操作成功=success · 只读完成=幽墨
  const isWriteOp = ['remember', 'forget'].includes(toolName);

  let iconColor: string;
  if (state === 'error') {
    iconColor = 'var(--danger)';
  } else if (state === 'call') {
    iconColor = 'var(--accent)';
  } else if (isWriteOp) {
    iconColor = 'var(--success)';
  } else {
    iconColor = 'var(--ink-ghost)';
  }
  const Icon = TOOL_ICON[toolName] ?? Wrench;
  // 只渲染契约里的 summary(后端算好);detail(正文/结论)不上页面
  const parsed = state !== 'call' && result ? parseToolResult(result) : null;

  return (
    // 批注式左边线 + 紧凑一行:图标 + 工具名(参数) · 结果摘要,省竖向篇幅(见 §7.1)
    <div
      className="my-0.5 border-l-2 pl-3 text-sm"
      style={{
        borderColor: 'var(--separator)',
        lineHeight: 1.5,
        // 工具卡与答案同处一个阅读面,统一用阅读体(霞鹜文楷),不混系统 sans
        fontFamily: 'var(--font-reading)',
        // 云雾凝聚:工具卡作为离散单元浮现时,模糊→清晰(只一次,见 index.css)
        animation: 'tool-coalesce 0.4s ease-out',
      }}
    >
      <div className="flex items-start gap-1.5">
        <Icon
          size={13}
          strokeWidth={2}
          className="mt-0.5 shrink-0"
          style={{
            color: iconColor,
            ...(state === 'call'
              ? { animation: 'pulse 1.5s ease-in-out infinite' }
              : {}),
          }}
        />
        <span style={{ color: 'var(--ink-faded)' }}>
          {name}
          {/* sub_agent 的参数(委派任务标题)紧跟工具名,执行中也显示;其余工具参数在 summary 里 */}
          {subLabel && <span>{' '}{subLabel}</span>}
          {/* summary = 结果统计;工具名/参数后接,带内部 "·" 分隔,按 status 上色 */}
          {parsed && (
            <span
              style={{
                color: parsed.status === 'error' ? 'var(--danger)' : 'var(--ink-ghost)',
              }}
            >
              {subLabel ? ' · ' : ' '}
              {parsed.summary}
            </span>
          )}
        </span>
      </div>

      {/* sub_agent 内部步骤:每步 = 工具 + 该步反馈统计(执行中实时,完成后从 meta.steps) */}
      {toolName === 'sub_agent' && displaySteps && (
        <StepList steps={displaySteps} />
      )}

      {/* "结果反馈"(search 命中篇目 / list 类型构成),由 meta.list 给 */}
      {parsed?.list && parsed.list.length > 0 && (
        <NestedList items={parsed.list} />
      )}
    </div>
  );
}
