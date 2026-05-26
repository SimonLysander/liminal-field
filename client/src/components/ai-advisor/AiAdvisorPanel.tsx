/**
 * AiAdvisorPanel — 写作顾问,编辑器三栏布局的左栏(紧凑侧栏布局)。
 *
 * 对话核心(useChat / 会话 / tier / tasks)抽到 useAdvisorChat,与全页总助手共用。
 * 本组件只负责侧栏布局 + 选中文字 add-to-chat + 输入框。
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Square, X, Paperclip } from 'lucide-react';
import type { EditOutcome } from '@/pages/admin/lib/apply-proposed-edits';
import type { AnchorPayload } from '@/pages/admin/lib/serialize-anchor';
import { MessageList } from './MessageList';
import { TaskChecklist } from './TaskChecklist';
import TextareaAutosize from 'react-textarea-autosize';
import { useAdvisorChat } from './use-advisor-chat';

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
  /**
   * AI 吐出 propose_edit 工具调用后,将解析到的 edits 上抛给父级。
   * 父级(ProseDraftEditor)在 <Plate> 之外拿不到 useEditorRef,通过此回调
   * 把 edits 透传给 PlateMarkdownEditor,再在 <Plate> 内部应用为 suggestion 痕迹。
   * 父级应用 useCallback 保证引用稳定,避免 useEffect 循环触发。
   */
  onProposedEdits?: (edits: Array<{ find: string; replace: string; reason: string }>, key: string) => void;
  /**
   * 改稿应用结果(失败项标红回流):由编辑器侧落痕迹后上报,经此透传到消息渲染。
   * 与 outcomesKey(对应 propose_edit 的 toolCallId)配套,定位到具体那张卡片。
   */
  outcomes?: EditOutcome[];
  /** 与 outcomes 配套的 key(propose_edit 的 toolCallId),用于匹配对应卡片 */
  outcomesKey?: string;
  /**
   * 当前编辑器锚点(selection/cursor)，由 ProseDraftEditor 从 AnchorBridge 中转而来。
   * 随聊天 transport 传给后端，prompt.handler 据此注入 <selection> / <cursor> 节。
   */
  anchor?: AnchorPayload;
}

export function AiAdvisorPanel({
  sessionKey,
  contentItemId,
  title,
  bodyMarkdown,
  selectedText,
  onProposedEdits,
  outcomes,
  outcomesKey,
  anchor,
}: AiAdvisorPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [greeting] = useState(pickGreeting);

  /** 用户手动取消的选区值;selectedText 变新值时自动重新生效 */
  const [dismissedText, setDismissedText] = useState<string | undefined>();
  const activeSelection =
    selectedText && selectedText !== dismissedText ? selectedText : undefined;

  const {
    messages,
    status,
    isStreaming,
    sessionReady,
    hasMore,
    isLoadingMore,
    loadMore,
    send,
    stop,
    error,
    tasks,
    planTitle,
    proposedEdits,
    editsKey,
  } = useAdvisorChat({
    sessionKey,
    agentKey: 'writing-advisor',
    source: 'notes-editor',
    documentContext: { contentItemId, title, bodyMarkdown },
    anchor,
  });

  // propose_edit 上抛:edits 落稳(非 streaming)后通知父级透传到编辑器。
  // onProposedEdits 由父级 useCallback 包裹,引用稳定,不会引起循环。
  useEffect(() => {
    if (proposedEdits.length > 0) {
      onProposedEdits?.(proposedEdits, editsKey);
    }
  }, [proposedEdits, editsKey, onProposedEdits]);

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

  return (
    // h-full:在笔记 grid 里等价于行 stretch(无变化);在文集条目 flex 容器里据此撑满高度
    <div className="flex h-full flex-col overflow-hidden">
      {/* 任务计划改为流内联清单(MessageList 末尾渲染),不再在顶部放常驻 TaskBar */}

      {/* 消息区 / 空状态 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {sessionReady && messages.length === 0 && (
          // 空状态:仅一句问候,居中留白。
          // (未来做 Aurora 主动/个性化问候时在此扩展;暂缓,故也不加纸艺装饰)
          <div className="flex flex-1 flex-col items-center justify-center px-5">
            <p
              className="text-center text-lg font-light"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.02em' }}
            >
              {greeting}
            </p>
          </div>
        )}
        {sessionReady && messages.length > 0 && (
          <MessageList
            messages={messages}
            status={status}
            sessionKey={sessionKey}
            error={error}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            outcomes={outcomes}
            outcomesKey={outcomesKey}
          />
        )}
      </div>

      {/* 独立「计划区」:钉在输入框上方。外层 px-3 对齐输入框盒,内层 px-3 对齐框内文字。 */}
      {tasks.some((t) => t.status !== 'done') && (
        <div className="shrink-0 px-3">
          <div
            className="px-3 pt-2.5"
            style={{ borderTop: '1px solid var(--separator)' }}
          >
            <TaskChecklist tasks={tasks} title={planTitle} />
          </div>
        </div>
      )}

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

        {/* focus 反馈作用在整个容器(输入框真正的边界),内层 textarea 因 composer-input 不再单独描边 */}
        <div
          className="advisor-composer flex items-center gap-2 rounded-xl px-3 py-2 transition-shadow"
          style={{ background: 'var(--shelf)' }}
        >
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
            className="composer-input flex-1 resize-none border-none bg-transparent text-sm leading-normal outline-none placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)', opacity: isStreaming ? 0.5 : 1 }}
          />

          {/* 长春花紫圆形键(有内容亮、空置淡灰),与全页一致;流式中变停止 */}
          {isStreaming ? (
            <button
              onClick={stop}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              aria-label="停止"
            >
              <Square size={11} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={isEmpty}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:cursor-default"
              style={{
                background: isEmpty ? 'color-mix(in srgb, var(--ink) 8%, transparent)' : 'var(--accent)',
                color: isEmpty ? 'var(--ink-ghost)' : 'var(--accent-contrast)',
              }}
              aria-label="发送"
            >
              <ArrowUp size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
