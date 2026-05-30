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
import { Copy, Check, Paperclip } from 'lucide-react';
import type { UIMessagePart, UIDataTypes, UITools } from 'ai';
import type {
  ChatReferenceSnapshot,
  ChatReferencesMetadata,
  AnchorPayload,
} from '@/pages/admin/lib/live-chat-selection';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
import { ToolCallCard } from './ToolCallCard';
import { AiEditProposalCard } from './AiEditProposalCard';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  metadata?: unknown;
  parts?: UIMessagePart<UIDataTypes, UITools>[];
  /** sub_agent 执行中实时步骤需要 sessionKey */
  sessionKey?: string;
  /** 舒适密度(全页 agent 用大字距;侧栏默认紧凑) */
  comfortable?: boolean;
  /**
   * v3 改稿 proposals 索引:key = toolCallId,value = Proposal。
   * tool-propose_document_rewrite 落稳后按 callId 查 Proposal 渲染 AiEditProposalCard。
   */
  proposalsByCallId?: Record<string, Proposal>;
  /** v3 改稿：点击 AiEditProposalCard 跳转到编辑器审批 */
  onJumpToEditor?: () => void;
  /** 内联工具卡片渲染器(场景注入):为工具 part 在原位渲染卡片,返回 null 用默认 ToolCallCard。 */
  renderToolCard?: (part: unknown) => ReactNode | null;
}

/** 将 DynamicToolUIPart 的 state 映射到 ToolCallCard 的 state 类型 */
function mapToolState(state: string): 'call' | 'result' | 'error' {
  switch (state) {
    case 'output-available': return 'result';
    case 'output-error': return 'error';
    default: return 'call';
  }
}

export function ChatMessage({
  role,
  content,
  metadata,
  parts,
  sessionKey,
  comfortable,
  proposalsByCallId,
  onJumpToEditor,
  renderToolCard,
}: ChatMessageProps) {
  if (role === 'user') {
    const references = getMessageReferences(metadata);
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
          <UserContentWithReferenceChips content={content} references={references} />
          {references.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border-t pt-1.5" style={{ borderColor: 'var(--separator)' }}>
              {references.map((reference, index) => (
                <div
                  key={reference.id || index}
                  className="flex items-start gap-1.5 text-xs leading-snug"
                  style={{ color: 'var(--ink-faded)' }}
                >
                  <Paperclip size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    {formatParagraphRange(reference.anchor)}
                    ：“{shortenReferencePreview(reference.preview || reference.text)}”
                  </span>
                </div>
              ))}
            </div>
          )}
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

            // 场景注入的内联卡片优先(如画廊 propose_caption):返回非 null 即原位渲染
            const scenarioCard = renderToolCard?.(part);
            if (scenarioCard != null) return <div key={i}>{scenarioCard}</div>;

            const p = part as Record<string, unknown>;
            const state = typeof p.state === 'string' ? mapToolState(p.state) : 'call';

            // v3 改稿工具：流式中走通用进行态；落稳后按 callId 查 Proposal 渲染卡片。
            if (toolName === 'propose_document_rewrite') {
              if (state !== 'result' && state !== 'error') {
                return (
                  <ToolCallCard
                    key={i}
                    toolName={toolName}
                    state="call"
                    sessionKey={sessionKey}
                  />
                );
              }
              const callId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
              const proposal = callId ? proposalsByCallId?.[callId] : undefined;
              if (!proposal) {
                return <ToolCallCard key={i} toolName={toolName} state="result" />;
              }
              return (
                <AiEditProposalCard
                  key={i}
                  proposal={proposal}
                  onJumpToEditor={onJumpToEditor}
                />
              );
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

/**
 * v3 协议:chips 在发送时被拼成 markdown `>` 引用块进 user message text:
 *   {用户原话}
 *
 *   > 第 N 段:「完整文本」
 *   > 第 M 段:「完整文本」
 *
 * 渲染时反解析:提取尾部连续的 `> 段号:「文本」` 行作为 chips,主文本不含引用。
 * 返回 { mainText, chips };若 content 无该模式,chips 为空,mainText = content。
 */
interface ParsedChip {
  label: string;
  text: string;
}
function parseInlineChips(content: string): { mainText: string; chips: ParsedChip[] } {
  // 匹配尾部 1 行或多行的 `> 第 N 段：「...」` 或 `> 引用：「...」`
  // 冒号兼容中文全角(formatReferencesAsMd 实际拼的)和英文半角(防御性)
  const chipLine = /^> (第\s*\d+(?:-\d+)?\s*段|引用)\s*[:：]\s*「([\s\S]+?)」\s*$/;
  const lines = content.split('\n');
  const chips: ParsedChip[] = [];
  // 从尾向前剥引用行(跳过空行)
  let cutIdx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') {
      // 允许空行做分隔,继续向前
      continue;
    }
    const match = line.match(chipLine);
    if (!match) break;
    chips.unshift({ label: match[1].replace(/\s+/g, ''), text: match[2] });
    cutIdx = i;
  }
  if (chips.length === 0) return { mainText: content, chips: [] };
  const mainText = lines.slice(0, cutIdx).join('\n').trimEnd();
  return { mainText, chips };
}

function UserContentWithReferenceChips({
  content,
  references,
}: {
  content: string;
  references: ChatReferenceSnapshot[];
}) {
  // 路径 1(老格式 `[已选内容 N]` token + metadata.references):保留兼容
  if (references.length > 0) {
    const parts = content.split(/(\[(?:已选内容|片段)\s+\d+\])/g).filter(Boolean);
    return (
      <>
        {parts.map((part, index) => {
          const match = part.match(/^\[(?:已选内容|片段)\s+(\d+)\]$/);
          if (!match) return <span key={index}>{part}</span>;
          const order = Number(match[1]);
          const reference = references.find((ref) => ref.order === order);
          const label = reference ? formatParagraphRange(reference.anchor) : '片段';
          return (
            <span
              key={index}
              className="mx-0.5 inline-flex max-w-[12rem] items-center rounded-md px-1.5 py-0.5 align-baseline text-xs"
              style={{
                background: 'color-mix(in srgb, var(--accent) 13%, var(--shelf))',
                color: 'var(--accent)',
              }}
              title={reference?.preview || reference?.text || label}
            >
              {label}
            </span>
          );
        })}
      </>
    );
  }

  // 路径 2(v3 协议 `> 段号:「文本」` markdown 引用块):从 content 解析
  const { mainText, chips } = parseInlineChips(content);
  if (chips.length === 0) return <>{content}</>;
  return (
    <>
      {mainText}
      {mainText && '\n'}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip, i) => (
          <span
            key={i}
            className="inline-flex max-w-[14rem] items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-xs"
            style={{
              background: 'color-mix(in srgb, var(--accent) 13%, var(--shelf))',
              color: 'var(--accent)',
            }}
            title={chip.text}
          >
            <Paperclip size={10} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{chip.label}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function getMessageReferences(metadata: unknown): ChatReferenceSnapshot[] {
  const refs = (metadata as ChatReferencesMetadata | undefined)?.references;
  if (!Array.isArray(refs)) return [];
  return refs.filter((ref): ref is ChatReferenceSnapshot => {
    return (
      typeof ref === 'object' &&
      ref !== null &&
      typeof ref.id === 'string' &&
      typeof ref.order === 'number' &&
      typeof ref.text === 'string' &&
      typeof ref.preview === 'string' &&
      typeof ref.anchor === 'object' &&
      ref.anchor !== null &&
      'type' in ref.anchor
    );
  });
}

function shortenReferencePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized;
}

function formatParagraphRange(anchor: AnchorPayload): string {
  if (anchor.type !== 'range') return '片段';
  const start = anchor.startPath?.[0] ?? anchor.blockIndex;
  const end = anchor.endPath?.[0] ?? start;
  const from = Math.min(start, end) + 1;
  const to = Math.max(start, end) + 1;
  return from === to ? `第 ${from} 段` : `第 ${from}-${to} 段`;
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
