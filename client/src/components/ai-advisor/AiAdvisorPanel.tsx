/**
 * AiAdvisorPanel — 写作顾问，三栏布局的左栏。
 *
 * 会话持久化 + 自动记忆召回 + 选中文字 add-to-chat。
 *
 * 生命周期（对应后端 hooks）：
 * 1. mount → loadSession(sessionKey, title) → 恢复对话 + 自动 recall 相关记忆
 * 2. 用户发消息 → transport body 携带 summary + relatedMemories + entryContext
 * 3. AI 回复完成 → saveSession(sessionKey, messages)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { Sparkles, Zap, Brain, ArrowUp, X } from 'lucide-react';
import { MessageList } from './MessageList';
import { TaskBar } from './TaskBar';
import TextareaAutosize from 'react-textarea-autosize';
import { loadSession, saveSession, type SessionTask } from '@/services/agent';

type Tier = 'flash' | 'standard' | 'think';

const TIER_ICON: Record<Tier, typeof Sparkles> = {
  flash: Zap,
  standard: Sparkles,
  think: Brain,
};
const TIER_LABEL: Record<Tier, string> = {
  flash: '闪电',
  standard: '标准',
  think: '深思',
};
const TIER_NEXT: Record<Tier, Tier> = {
  flash: 'standard',
  standard: 'think',
  think: 'flash',
};

const GREETINGS = [
  '写到哪了？',
  '有什么想聊的？',
  '需要帮忙想想？',
  '思路卡住了？',
  '今天写什么？',
];

function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

export interface AiAdvisorPanelProps {
  /** 会话标识，不透明字符串，调用方决定语义 */
  sessionKey: string;
  contentItemId?: string;
  title?: string;
  bodyMarkdown?: string;
  /** 编辑器中当前选中的文字（Cursor 式 add-to-chat） */
  selectedText?: string;
}

export function AiAdvisorPanel({
  sessionKey,
  contentItemId,
  title,
  bodyMarkdown,
  selectedText,
}: AiAdvisorPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [currentTier, setCurrentTier] = useState<Tier>('standard');
  const [greeting] = useState(pickGreeting);
  const [sessionReady, setSessionReady] = useState(false);
  const [tasks, setTasks] = useState<SessionTask[]>([]);

  /**
   * 记录被用户手动取消的 selectedText 值。
   * 当 selectedText 变为新的值时，自动重新生效（因为不等于 dismissedText）。
   */
  const [dismissedText, setDismissedText] = useState<string | undefined>();

  /** 实际生效的选中文字（用户取消后 selectedText === dismissedText → 无效） */
  const activeSelection = selectedText && selectedText !== dismissedText ? selectedText : undefined;

  // ── Ref 层：持有最新值供 transport body 回调读取 ──
  const entryContextRef = useRef({ contentItemId, title, bodyMarkdown });
  const tierRef = useRef(currentTier);
  const summaryRef = useRef('');
  const relatedMemoriesRef = useRef<Array<{ key: string; type: string; title: string; content: string }>>([]);

  useEffect(() => {
    entryContextRef.current = { contentItemId, title, bodyMarkdown };
  }, [contentItemId, title, bodyMarkdown]);

  useEffect(() => {
    tierRef.current = currentTier;
  }, [currentTier]);

  // ── Transport：只创建一次，body 回调通过 ref 读最新值 ──
  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        body: () => ({
          tier: tierRef.current,
          agentKey: 'writing-advisor',
          sessionSummary: summaryRef.current || undefined,
          relatedMemories: relatedMemoriesRef.current.length > 0
            ? relatedMemoriesRef.current
            : undefined,
          entryContext: {
            source: 'notes-editor',
            sessionKey,
            document: entryContextRef.current.contentItemId
              ? {
                  contentItemId: entryContextRef.current.contentItemId,
                  title: entryContextRef.current.title,
                  bodyMarkdown: entryContextRef.current.bodyMarkdown,
                }
              : undefined,
          },
        }),
      }),
  );

  const { messages, sendMessage, setMessages, status } = useChat({ transport });
  /* eslint-enable react-hooks/refs */

  // ── SessionLoad hook：加载历史消息 + 自动 recall ──
  useEffect(() => {
    let cancelled = false;
    loadSession(sessionKey, title)
      .then((data) => {
        if (cancelled) return;
        summaryRef.current = data.summary || '';
        relatedMemoriesRef.current = data.relatedMemories || [];
        if (data.messages.length > 0) {
          setMessages(data.messages as unknown as UIMessage[]);
        }
        if (data.tasks?.length > 0) {
          setTasks(data.tasks);
        }
        setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => { cancelled = true; };
  }, [sessionKey, title, setMessages]);

  // ── AfterChat hook：自动保存 + 从 response 刷新 tasks ──
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive = prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const nowReady = status === 'ready';
    prevStatusRef.current = status;

    if (wasActive && nowReady && messages.length > 0) {
      void saveSession(sessionKey, messages as unknown as Record<string, unknown>[]).then(
        (res) => {
          if (res?.tasks) setTasks(res.tasks);
        },
      );
    }
  }, [status, messages, sessionKey]);

  // ── 发送：add-to-chat（选中文字拼接到消息前面）──
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    // 如果有选中文字，拼接到消息前面
    const finalText = activeSelection
      ? `[选中文字]\n${activeSelection}\n[/选中文字]\n\n${text}`
      : text;

    setInputValue('');
    // 发送后取消选区
    if (activeSelection) setDismissedText(activeSelection);
    void sendMessage({ text: finalText });
  }, [inputValue, activeSelection, sendMessage]);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const isEmpty = inputValue.trim().length === 0;
  const TierIcon = TIER_ICON[currentTier];

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Task bar（有任务时显示） */}
      {sessionReady && <TaskBar tasks={tasks} />}

      {/* 消息区 / 空状态 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {sessionReady && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5">
            <p
              className="text-center font-light"
              style={{
                color: 'var(--ink-ghost)',
                fontSize: 'var(--text-lg)',
                letterSpacing: '0.02em',
              }}
            >
              {greeting}
            </p>
            {/* 预设问题卡片 */}
            <div className="flex flex-col gap-2 w-full max-w-[220px]">
              {[
                '这篇文章的结构合理吗',
                '帮我理一下思路',
                '有没有类似的内容可以参考',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => void sendMessage({ text: q })}
                  className="rounded-lg px-3 py-2 text-left text-xs transition-colors"
                  style={{
                    color: 'var(--ink-faded)',
                    background: 'var(--shelf)',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {sessionReady && messages.length > 0 && (
          <MessageList messages={messages} status={status} sessionKey={sessionKey} />
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 px-3 pb-4 pt-2">
        {/* 选中文字 add-to-chat pill */}
        {activeSelection && (
          <div className="mb-2 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
              style={{
                background: 'var(--shelf)',
                color: 'var(--ink-faded)',
              }}
            >
              📎 已选中 {activeSelection.length} 字
            </span>
            <button
              onClick={() => setDismissedText(selectedText)}
              className="rounded-full p-0.5 transition-colors hover:opacity-70"
              style={{ color: 'var(--ink-ghost)' }}
              aria-label="取消选区"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--shelf)' }}
        >
          {/* Tier 图标：循环切换 */}
          <button
            onClick={() => setCurrentTier((t) => TIER_NEXT[t])}
            disabled={isStreaming}
            className="mb-px shrink-0 transition-colors duration-150 disabled:opacity-40"
            style={{ color: 'var(--ink-ghost)' }}
            title={`${TIER_LABEL[currentTier]}（点击切换）`}
          >
            <TierIcon size={14} strokeWidth={1.5} />
          </button>

          <TextareaAutosize
            minRows={1}
            maxRows={4}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isEmpty && !isStreaming) handleSend();
              }
            }}
            disabled={isStreaming}
            placeholder="聊点什么..."
            className="flex-1 resize-none border-none bg-transparent text-sm outline-none placeholder:text-[var(--ink-ghost)]"
            style={{
              color: 'var(--ink)',
              lineHeight: 1.5,
              opacity: isStreaming ? 0.5 : 1,
              padding: 0,
              margin: 0,
              boxShadow: 'none',
            }}
          />

          <button
            onClick={handleSend}
            disabled={isEmpty || isStreaming}
            className="mb-px shrink-0 transition-all duration-150"
            style={{
              color: isEmpty || isStreaming ? 'var(--ink-ghost)' : 'var(--ink)',
            }}
            aria-label="发送"
          >
            <ArrowUp size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
