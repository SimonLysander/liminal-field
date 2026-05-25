/**
 * ChatMessage — 渲染单条对话消息。
 *
 * 用户消息：右对齐，accent 背景气泡，纯文本。
 * 助手消息：左对齐，无气泡，用 react-markdown 渲染 Markdown，
 *           parts 中 tool-* 类型渲染为 ToolCallCard 内联指示器。
 */

import { isValidElement, memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { Copy, Check } from 'lucide-react';
import type { UIMessagePart, UIDataTypes, UITools } from 'ai';
import { ToolCallCard } from './ToolCallCard';
import { ProposedEditCard } from './ProposedEditCard';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  parts?: UIMessagePart<UIDataTypes, UITools>[];
  /** sub_agent 执行中实时步骤需要 sessionKey */
  sessionKey?: string;
  /** 舒适密度(全页 agent 用大字距;侧栏默认紧凑) */
  comfortable?: boolean;
}

/** 将 DynamicToolUIPart 的 state 映射到 ToolCallCard 的 state 类型 */
function mapToolState(state: string): 'call' | 'result' | 'error' {
  switch (state) {
    case 'output-available': return 'result';
    case 'output-error': return 'error';
    default: return 'call';
  }
}

export function ChatMessage({ role, content, parts, sessionKey, comfortable }: ChatMessageProps) {
  if (role === 'user') {
    return (
      /* 用户消息：右对齐，轻量 shelf 背景，不喧宾夺主 */
      <div className="flex justify-end">
        <div
          className={`max-w-[85%] rounded-xl ${comfortable ? 'px-4 py-2.5 text-md' : 'px-3.5 py-2 text-sm'}`}
          style={{
            background: 'var(--shelf)',
            color: 'var(--ink)',
            // 对话是同一个阅读面:用户发言与 Aurora 回答统一用阅读体(霞鹜文楷)
            fontFamily: 'var(--font-reading)',
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // 助手消息：无气泡，Markdown 渲染。
  // 有 parts 时优先按 parts 渲染（可能含 tool call 卡片），否则直接渲染 content。
  // write_tasks 不进工具流水(它由钉在输入框上方的独立「计划区」统一渲染,见 use-advisor-chat)。
  const body =
    parts && parts.length > 0 ? (
      <div className="flex flex-col gap-1">
        {parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <AssistantMarkdown key={i} content={part.text} comfortable={comfortable} />
            );
          }

          // AI SDK v6: 工具调用 part 类型格式为 tool-{工具名}
          if (part.type.startsWith('tool-')) {
            const toolName = part.type.slice(5); // 去掉 "tool-" 前缀
            if (toolName === 'write_tasks') return null; // 清单统一渲染在消息末尾

            const p = part as Record<string, unknown>;
            const state = typeof p.state === 'string' ? mapToolState(p.state) : 'call';

            // propose_edit:用专属卡片渲染逐条 reason,不走通用 ToolCallCard。
            // input-streaming 阶段 edits 还没传完,回退到 ToolCallCard 进行中态。
            if (toolName === 'propose_edit') {
              const input = 'input' in p ? (p.input as { edits?: Array<{ find: string; replace: string; reason: string }> }) : undefined;
              const edits = input?.edits;
              if (state === 'call' || !edits || edits.length === 0) {
                // 流式进行中 或 edits 为空:用通用卡片显示进行中态
                return (
                  <ToolCallCard
                    key={i}
                    toolName={toolName}
                    state={state}
                    sessionKey={sessionKey}
                  />
                );
              }
              // edits 到位后渲染专属卡片(本 task 不传 outcomes/onJumpFirst)
              return <ProposedEditCard key={i} edits={edits} />;
            }

            const resultStr =
              'output' in p && p.output != null
                ? typeof p.output === 'string'
                  ? p.output
                  : JSON.stringify(p.output, null, 2)
                : undefined;

            return (
              <ToolCallCard
                key={i}
                toolName={toolName}
                state={state}
                args={'input' in p ? p.input : undefined}
                result={resultStr}
                sessionKey={sessionKey}
              />
            );
          }

          // reasoning、step-start 等：不渲染（跟 Claude Code 一致）
          return null;
        })}
      </div>
    ) : (
      <AssistantMarkdown content={content} comfortable={comfortable} />
    );

  // group/msg:hover 时浮出复制操作(纸墨克制,不喧宾夺主)
  return (
    <div className="group/msg flex flex-col gap-1.5">
      {body}
      <MessageActions text={content} />
    </div>
  );
}

/** 助手消息 hover 操作条:目前只有复制(纯墨幽，hover 才现)。 */
function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
      <button
        onClick={handleCopy}
        aria-label="复制"
        className="rounded-md p-1 transition-colors"
        style={{ color: copied ? 'var(--success)' : 'var(--ink-ghost)' }}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.5} />}
      </button>
    </div>
  );
}

/** 代码块:shelf 底色 + 横向滚动 + 左上角语言标签 + hover 右上角复制(读自身 textContent)。 */
function CodeBlock({ children, comfortable }: { children?: ReactNode; comfortable?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // 从子 <code class="language-xxx"> 取语言名(rehype-highlight 会写上),做左上角标签
  const codeClass =
    isValidElement(children) && children.props
      ? (children.props as { className?: string }).className
      : undefined;
  const lang = codeClass?.match(/language-(\w+)/)?.[1] ?? '';

  const handleCopy = () => {
    const text = ref.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group relative my-2">
      {/* 语言标签(左上,常驻):没语言就不显示 */}
      {lang && (
        <span
          className="absolute left-3 top-1.5 select-none text-2xs lowercase tracking-wide"
          style={{ color: 'var(--ink-ghost)' }}
        >
          {lang}
        </span>
      )}
      <button
        onClick={handleCopy}
        aria-label="复制代码"
        className="absolute right-2 top-1.5 rounded-md p-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: 'var(--paper)', color: 'var(--ink-ghost)' }}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.5} />}
      </button>
      <pre
        ref={ref}
        className={`overflow-x-auto rounded-md px-3 pb-3 ${lang ? 'pt-7' : 'pt-3'} ${comfortable ? 'text-sm' : 'text-xs'}`}
        style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * 助手消息的 Markdown 渲染块，含基础 prose 样式。
 * memo:content 不变就不重渲染 —— 流式时只有"正在生成的那条"在变,历史消息不再
 * 每个 chunk 都重跑 react-markdown + 高亮 + 公式(这是之前"卡卡"的主因)。
 */
const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  comfortable,
}: {
  content: string;
  comfortable?: boolean;
}) {
  return (
    <div
      className={`prose prose-sm max-w-none leading-relaxed ${comfortable ? 'text-md' : 'text-xs'}`}
      style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-reading)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          // 统一用 CSS 变量覆盖 prose 默认色，保持设计系统一致
          p: ({ children }) => (
            <p className="my-2" style={{ color: 'var(--ink-faded)' }}>{children}</p>
          ),
          code: ({ children, className }) => {
            // 行内代码 vs 代码块:带 language-/hljs class 视为代码块(rehype-highlight 会加 hljs)。
            // 代码块的底色/内边距交给外层 pre(CodeBlock),此处保持透明,避免双层底色。
            const isBlock =
              !!className &&
              (className.includes('language-') || className.includes('hljs'));
            return (
              <code
                className={`${isBlock ? '' : 'rounded-sm'} ${comfortable ? 'text-sm' : 'text-xs'}${className ? ` ${className}` : ''}`}
                style={{
                  color: 'var(--ink-faded)',
                  background: isBlock ? 'transparent' : 'var(--shelf)',
                  padding: isBlock ? undefined : '1px 4px',
                }}
              >
                {children}
              </code>
            );
          },
          // 代码块容器:底色 + 横向滚动 + hover 显示复制按钮
          pre: ({ children }) => <CodeBlock comfortable={comfortable}>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              {children}
            </a>
          ),
          h1: ({ children }) => (
            <h1 className={`mb-1 mt-3 font-semibold ${comfortable ? 'text-base' : 'text-sm'}`} style={{ color: 'var(--ink)' }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className={`mb-1 mt-2.5 font-semibold ${comfortable ? 'text-sm' : 'text-xs'}`} style={{ color: 'var(--ink)' }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className={`mb-1 mt-2 font-medium ${comfortable ? 'text-sm' : 'text-xs'}`} style={{ color: 'var(--ink)' }}>{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc pl-4" style={{ color: 'var(--ink)' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal pl-4" style={{ color: 'var(--ink)' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li className="my-0.5" style={{ color: 'var(--ink)' }}>{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="my-1.5 border-l-2 pl-3"
              style={{ borderColor: 'var(--separator)', color: 'var(--ink-faded)' }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse', color: 'var(--ink)' }}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="px-2 py-1 text-left font-medium"
              style={{ borderBottom: '1px solid var(--separator)', color: 'var(--ink-faded)' }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-2 py-1"
              style={{ borderBottom: '1px solid var(--separator)' }}
            >
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
