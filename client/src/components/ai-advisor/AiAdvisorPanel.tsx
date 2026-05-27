/**
 * AiAdvisorPanel — 写作顾问,编辑器三栏布局的左栏(紧凑侧栏布局)。
 *
 * 对话核心(useChat / 会话 / tier / tasks)抽到 useAdvisorChat,与全页总助手共用。
 * 本组件只负责侧栏布局 + 选中文字 add-to-chat + 输入框。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Descendant } from 'platejs';
import { ArrowUp, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import type { ChatSelectionAttachment, AnchorPayload } from '@/pages/admin/lib/live-chat-selection';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
import {
  deleteSession,
  listBusinessSessions,
  renameBusinessSession,
  type BusinessSessionSummary,
} from '@/services/agent';
import {
  AiReferenceComposer,
  type AiReferenceComposerHandle,
} from './AiReferenceComposer';
import { MessageList } from './MessageList';
import { TaskChecklist } from './TaskChecklist';
import { useAdvisorChat } from './use-advisor-chat';
import { toAdvisorSendText } from './advisor-send-text';

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
  /** 已显式添加到聊天的编辑器选区引用（Cursor 式 add-to-chat, live range） */
  selectionAttachments?: ChatSelectionAttachment[];
  /** 移除单个已添加的选区附件 */
  onRemoveSelectionAttachment?: (id: string) => void;
  /** 清除已添加的选区附件 */
  onClearSelectedText?: () => void;
  /**
   * 当前编辑器锚点(selection/cursor)，由 ProseDraftEditor 从 AnchorBridge 中转而来。
   * 保留给 transport/context 使用；不在 UI 中自动展示，避免拖选即暗示”将改写选中”。
   */
  anchor?: AnchorPayload;
  /**
   * 发送消息时读取最新锚点。selection 拖拽过程中最新值写在父级 ref 里，
   * transport body 通过这个 getter 读取，避免为了拿最新锚点而每次 selectionchange 都 setState。
   */
  getAnchor?: () => AnchorPayload;
  /**
   * v3 改稿：最近 pendingProposal 变化时回调上层。
   * 上层（ProseDraftEditor）拿到后透传给 ProposalOverlay / useProposalController。
   * 用 ref 模式避免回调不稳定导致 useEffect 频繁触发。
   */
  onProposalChange?: (proposal: Proposal | undefined) => void;
  /**
   * v3 改稿：获取当前 editor.children，供 useAdvisorChat 里 computeDocDiff 使用。
   * 由 ProseDraftEditor 通过 getEditorChildren 传入。
   */
  getEditorChildren?: () => Descendant[];
  /**
   * v3 改稿：获取当前 Plate editor 实例，供 deserializeMd(editor, newMarkdown) 使用。
   * 由 ProseDraftEditor 通过 getEditor 传入。
   */
  getEditor?: () => unknown;
}

export function AiAdvisorPanel({
  sessionKey,
  contentItemId,
  title,
  bodyMarkdown,
  selectionAttachments,
  onRemoveSelectionAttachment,
  onClearSelectedText,
  onProposalChange,
  getEditorChildren,
  getEditor,
}: AiAdvisorPanelProps) {
  const agentInstanceKey = sessionKey;
  const [currentSessionKey, setCurrentSessionKey] = useState(sessionKey);
  const [sessions, setSessions] = useState<BusinessSessionSummary[]>([]);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const composerRef = useRef<AiReferenceComposerHandle>(null);
  const currentSessionKeyRef = useRef(currentSessionKey);
  const hasPickedInitialSessionRef = useRef(false);
  const userControlledSessionRef = useRef(false);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [greeting] = useState(pickGreeting);

  // 用 useMemo 稳定引用，避免 ?? [] 每次渲染产生新数组引用，触发 useCallback 重建
  const activeSelections = useMemo(() => selectionAttachments ?? [], [selectionAttachments]);

  const refreshSessions = useCallback(() => {
    void listBusinessSessions(agentInstanceKey)
      .then((items) => {
        setSessionListError(null);
        const currentKey = currentSessionKeyRef.current;
        if (!hasPickedInitialSessionRef.current) {
          hasPickedInitialSessionRef.current = true;
          if (!userControlledSessionRef.current && items[0]?.sessionKey) {
            setCurrentSessionKey(items[0].sessionKey);
            setSessions(items);
            return;
          }
        }
        setSessions(ensureVisibleSession(items, currentKey, agentInstanceKey));
      })
      .catch((error) => {
        setSessionListError(
          error instanceof Error ? error.message : '会话列表加载失败',
        );
      });
  }, [agentInstanceKey]);

  useEffect(() => {
    currentSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    userControlledSessionRef.current = false;
    hasPickedInitialSessionRef.current = false;
    // 推迟 setState 到微任务，避免在 effect 同步体内调用（react-hooks/set-state-in-effect）
    queueMicrotask(() => { setCurrentSessionKey(sessionKey); });
  }, [sessionKey]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // v3 改稿：用 ref 保存 onProposalChange，避免回调引用不稳定导致 useEffect 频繁触发
  const onProposalChangeRef = useRef(onProposalChange);
  useEffect(() => {
    onProposalChangeRef.current = onProposalChange;
  }, [onProposalChange]);

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
    proposalsByCallId,
    pendingProposal,
  } = useAdvisorChat({
    sessionKey: currentSessionKey,
    agentInstanceKey,
    agentKey: 'writing-advisor',
    source: 'notes-editor',
    documentContext: { contentItemId, title, bodyMarkdown },
    onAfterSave: refreshSessions,
    getEditorChildren,
    getEditor,
  });

  // v3 改稿：pendingProposal 变化时通过 ref 回调上层，避免 onProposalChange 引用不稳导致循环
  useEffect(() => {
    onProposalChangeRef.current?.(pendingProposal);
  }, [pendingProposal]);

  useEffect(() => {
    // 切换会话时清 pendingProposal
    onProposalChangeRef.current?.(undefined);
  }, [currentSessionKey]);

  // v3 发送：chips 已在 readAndClear 内拼成 markdown > 引用块，只传 text。
  const handleSend = useCallback(() => {
    const payload = composerRef.current?.readAndClear() ?? { text: '' };
    const text = toAdvisorSendText(payload.text);
    if (!text) return;
    setComposerEmpty(true);
    send(text);
    if (activeSelections.length > 0) onClearSelectedText?.();
  }, [activeSelections, onClearSelectedText, send]);

  const handleNewSession = useCallback(() => {
    const nextKey = createBusinessSessionKey(agentInstanceKey);
    userControlledSessionRef.current = true;
    hasPickedInitialSessionRef.current = true;
    setCurrentSessionKey(nextKey);
    setSessions((prev) => ensureVisibleSession(prev, nextKey, agentInstanceKey));
    onClearSelectedText?.();
  }, [agentInstanceKey, onClearSelectedText]);

  const handleRenameSession = useCallback(() => {
    const current = ensureVisibleSession(
      sessions,
      currentSessionKey,
      agentInstanceKey,
    ).find((session) => session.sessionKey === currentSessionKey);
    const nextTitle = window.prompt('会话名称', current?.title ?? '新会话');
    if (nextTitle == null) return;
    const cleanTitle = nextTitle.trim();
    if (!cleanTitle) return;
    void renameBusinessSession(currentSessionKey, cleanTitle)
      .then(() => {
        setSessionListError(null);
        setSessions((prev) =>
          ensureVisibleSession(prev, currentSessionKey, agentInstanceKey).map(
            (session) =>
              session.sessionKey === currentSessionKey
                ? { ...session, title: cleanTitle }
                : session,
          ),
        );
      })
      .catch((error) => {
        setSessionListError(
          error instanceof Error ? error.message : '会话命名失败',
        );
      });
  }, [agentInstanceKey, currentSessionKey, sessions]);

  const handleDeleteSession = useCallback(() => {
    const deletingKey = currentSessionKey;
    void deleteSession(deletingKey).then(async () => {
      const items = await listBusinessSessions(agentInstanceKey);
      const next = items.find((item) => item.sessionKey !== deletingKey);
      const nextKey = next?.sessionKey ?? createBusinessSessionKey(agentInstanceKey);
      setCurrentSessionKey(nextKey);
      setSessions(ensureVisibleSession(items, nextKey, agentInstanceKey));
      setSessionListError(null);
      onClearSelectedText?.();
    }).catch((error) => {
      setSessionListError(
        error instanceof Error ? error.message : '会话删除失败',
      );
    });
  }, [agentInstanceKey, currentSessionKey, onClearSelectedText]);

  const isEmpty = composerEmpty;

  return (
    // h-full:在笔记 grid 里等价于行 stretch(无变化);在文集条目 flex 容器里据此撑满高度
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-1 px-3 py-2"
        style={{ borderBottom: '1px solid var(--separator)' }}
      >
        <select
          value={currentSessionKey}
          onChange={(event) => {
            userControlledSessionRef.current = true;
            hasPickedInitialSessionRef.current = true;
            setCurrentSessionKey(event.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          style={{ color: 'var(--ink-faded)' }}
          aria-label="选择会话"
        >
          {ensureVisibleSession(sessions, currentSessionKey, agentInstanceKey).map((session) => (
            <option key={session.sessionKey} value={session.sessionKey}>
              {session.title || '新会话'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRenameSession}
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ color: 'var(--ink-faded)' }}
          aria-label="命名当前会话"
          title="命名当前会话"
        >
          <Pencil size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={handleNewSession}
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ color: 'var(--ink-faded)' }}
          aria-label="新会话"
          title="新会话"
        >
          <Plus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={handleDeleteSession}
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ color: 'var(--ink-faded)' }}
          aria-label="删除当前会话"
          title="删除当前会话"
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
      {sessionListError && (
        <div className="shrink-0 px-3 pb-2 text-xs" style={{ color: 'var(--mark-red)' }}>
          {sessionListError}
        </div>
      )}
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
            sessionKey={currentSessionKey}
            error={error}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMore}
            proposalsByCallId={proposalsByCallId}
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
        {/* focus 反馈作用在整个容器(输入框真正的边界),contenteditable 负责 inline 引用 token */}
        <div
          className="advisor-composer flex items-end gap-2 rounded-xl px-3 py-2 transition-shadow"
          style={{ background: 'var(--shelf)' }}
          onMouseDown={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('button')) return;
            composerRef.current?.focusEnd();
          }}
        >
          <AiReferenceComposer
            key={currentSessionKey}
            ref={composerRef}
            selections={activeSelections}
            disabled={isStreaming}
            onRemoveSelection={onRemoveSelectionAttachment}
            onEmptyChange={setComposerEmpty}
            onSubmit={() => {
              if (!composerRef.current?.isEmpty() && !isStreaming) handleSend();
            }}
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

function createBusinessSessionKey(agentInstanceKey: string): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${agentInstanceKey}:chat:${id}`;
}

function ensureVisibleSession(
  sessions: BusinessSessionSummary[],
  currentSessionKey: string,
  agentInstanceKey: string,
): BusinessSessionSummary[] {
  if (sessions.some((session) => session.sessionKey === currentSessionKey)) {
    return sessions;
  }
  return [
    {
      sessionKey: currentSessionKey,
      title: currentSessionKey === agentInstanceKey ? '默认会话' : '新会话',
      messageCount: 0,
      lastActiveAt: null,
    },
    ...sessions,
  ];
}
