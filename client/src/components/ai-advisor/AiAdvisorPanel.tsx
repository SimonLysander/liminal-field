/**
 * AiAdvisorPanel — 写作顾问,编辑器三栏布局的左栏(紧凑侧栏布局)。
 *
 * 对话核心(useChat / 会话 / tier / tasks)抽到 useAdvisorChat,与全页总助手共用。
 * 本组件只负责侧栏布局 + 选中文字 add-to-chat + 输入框。
 */

import { useCallback, useState } from 'react';
import { Sparkles, Zap, Brain, ArrowUp, X, Paperclip } from 'lucide-react';
import { MessageList } from './MessageList';
import { TaskBar } from './TaskBar';
import TextareaAutosize from 'react-textarea-autosize';
import { useAdvisorChat, type Tier } from './use-advisor-chat';

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
  /** 会话标识,不透明字符串,调用方决定语义 */
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
  const [greeting] = useState(pickGreeting);

  /** 用户手动取消的选区值;selectedText 变新值时自动重新生效 */
  const [dismissedText, setDismissedText] = useState<string | undefined>();
  const activeSelection =
    selectedText && selectedText !== dismissedText ? selectedText : undefined;

  const { messages, status, isStreaming, sessionReady, tasks, tier, cycleTier, send } =
    useAdvisorChat({
      sessionKey,
      agentKey: 'writing-advisor',
      source: 'notes-editor',
      documentContext: { contentItemId, title, bodyMarkdown },
    });

  // 发送:add-to-chat(选中文字拼接到消息前面)
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    const finalText = activeSelection
      ? `[选中文字]\n${activeSelection}\n[/选中文字]\n\n${text}`
      : text;
    setInputValue('');
    if (activeSelection) setDismissedText(activeSelection);
    send(finalText);
  }, [inputValue, activeSelection, send]);

  const isEmpty = inputValue.trim().length === 0;
  const TierIcon = TIER_ICON[tier];

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Task bar（有任务时显示） */}
      {sessionReady && <TaskBar tasks={tasks} />}

      {/* 消息区 / 空状态 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {sessionReady && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5">
            <p
              className="text-center text-lg font-light"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.02em' }}
            >
              {greeting}
            </p>
            {/* 预设问题卡片 */}
            <div className="flex w-full max-w-[220px] flex-col gap-2">
              {[
                '这篇文章的结构合理吗',
                '帮我理一下思路',
                '有没有类似的内容可以参考',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-lg px-3 py-2 text-left text-xs transition-colors"
                  style={{ color: 'var(--ink-faded)', background: 'var(--shelf)' }}
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
              style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
            >
              <Paperclip size={12} strokeWidth={1.5} />
              已选中 {activeSelection.length} 字
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
          {/* Tier 图标:循环切换 */}
          <button
            onClick={cycleTier}
            disabled={isStreaming}
            className="mb-px shrink-0 transition-colors duration-150 disabled:opacity-40"
            style={{ color: 'var(--ink-ghost)' }}
            title={`${TIER_LABEL[tier]}（点击切换）`}
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
            className="flex-1 resize-none border-none bg-transparent text-sm leading-normal outline-none placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)', opacity: isStreaming ? 0.5 : 1 }}
          />

          <button
            onClick={handleSend}
            disabled={isEmpty || isStreaming}
            className="mb-px shrink-0 transition-all duration-150"
            style={{ color: isEmpty || isStreaming ? 'var(--ink-ghost)' : 'var(--ink)' }}
            aria-label="发送"
          >
            <ArrowUp size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
