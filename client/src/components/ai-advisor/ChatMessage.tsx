/**
 * ChatMessage — 渲染单条对话消息。
 *
 * 用户消息：右对齐，accent 背景气泡，纯文本。
 * 助手消息：左对齐，无气泡，用 react-markdown 渲染 Markdown，
 *           parts 中 tool-* 类型渲染为 ToolCallCard 内联指示器。
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UIMessagePart, UIDataTypes, UITools } from 'ai';
import { ToolCallCard } from './ToolCallCard';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  parts?: UIMessagePart<UIDataTypes, UITools>[];
  /** sub_agent 实时进度需要 sessionKey */
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
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  // 助手消息：无气泡，Markdown 渲染
  // 如果有 parts，优先按 parts 渲染（可能包含 tool call 卡片）
  if (parts && parts.length > 0) {
    return (
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
            const p = part as Record<string, unknown>;
            const state = typeof p.state === 'string' ? mapToolState(p.state) : 'call';
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
    );
  }

  // 无 parts 时直接渲染 content 字符串
  return <AssistantMarkdown content={content} comfortable={comfortable} />;
}

/** 助手消息的 Markdown 渲染块，含基础 prose 样式 */
function AssistantMarkdown({ content, comfortable }: { content: string; comfortable?: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none leading-relaxed ${comfortable ? 'text-md' : 'text-xs'}`}
      style={{ color: 'var(--ink-faded)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 统一用 CSS 变量覆盖 prose 默认色，保持设计系统一致
          p: ({ children }) => (
            <p className="my-2" style={{ color: 'var(--ink-faded)' }}>{children}</p>
          ),
          code: ({ children, className }) => {
            // 行内代码 vs 代码块：有语言 class 视为代码块，代码块无内边距
            const isBlock = className?.startsWith('language-');
            return (
              <code
                className={`rounded-sm ${comfortable ? 'text-sm' : 'text-xs'}${className ? ` ${className}` : ''}`}
                style={{
                  color: 'var(--ink-faded)',
                  background: 'var(--shelf)',
                  padding: isBlock ? undefined : '1px 4px',
                }}
              >
                {children}
              </code>
            );
          },
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
}
