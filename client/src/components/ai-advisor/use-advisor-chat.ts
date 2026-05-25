/**
 * useAdvisorChat — Aurora 对话核心(侧栏写作顾问 + 全页总助手共用)。
 *
 * 抽出 useChat + transport + 会话加载/保存 + tier 这套 plumbing,
 * 让不同布局(编辑器侧栏 / 独立 agent 页)复用同一份功能逻辑,不重复造。
 *
 * 选区(选中文字 add-to-chat)、输入框状态、空态问候、渲染 → 留给各自布局组件,
 * 它们用 send(text) 把最终文本发出去。
 *
 * 生命周期(对应后端 hooks):
 * 1. mount → loadSession(sessionKey) → 恢复对话（首屏加载最近一页）
 *    session 记忆脉络由后端注入 system prompt，前端不管
 * 2. 滚到顶懒加载 → loadSession(sessionKey, { before: firstIndex }) → 前拼更早消息
 * 3. send → transport body 携带 entryContext(可选文档)
 * 4. 回复完成 → saveSession(sessionKey, newMessages) — 只发本轮新增（方案A append）
 *
 * 分段聚合分页设计（U7 新增）：
 * - 后端 onAfterChat 是纯 append 语义，前端必须只发新增消息，否则全量重发导致重复追加
 * - savedCountRef 记录已保存的 messages.length，每次回复后截取 messages.slice(savedCount) 发送
 * - hasMoreRef / firstIndexRef 记录懒加载游标，onLoadMore 时传 before=firstIndex
 * - 懒加载拼接：把旧页消息 prepend 到当前 messages 头部，用户无感分段
 *
 * U6 变更（relatedMemories）：
 * - project 自动召回已删，relatedMemories 恒为空数组，前端不再维护该字段
 * - session 记忆脉络由后端注入 system prompt，前端 transport body 无需回传
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { loadSession, saveSession, type SessionTask } from '@/services/agent';

export type Tier = 'flash' | 'standard' | 'think';

const TIER_NEXT: Record<Tier, Tier> = {
  flash: 'standard',
  standard: 'think',
  think: 'flash',
};

export interface UseAdvisorChatOptions {
  /** 会话标识,不透明字符串 */
  sessionKey: string;
  /** 后端 agent 入口 key(如 'writing-advisor') */
  agentKey: string;
  /** entryContext.source 标记来源(如 'notes-editor' / 'agent-page') */
  source: string;
  /** 可选:绑定的文档(侧栏写作顾问传;全页总助手不传) */
  documentContext?: {
    contentItemId?: string;
    title?: string;
    bodyMarkdown?: string;
  };
}

export function useAdvisorChat({
  sessionKey,
  agentKey,
  source,
  documentContext,
}: UseAdvisorChatOptions) {
  const [tier, setTier] = useState<Tier>('standard');
  const [sessionReady, setSessionReady] = useState(false);

  // 懒加载状态：hasMore 控制是否显示"加载更多"触发区，isLoadingMore 防重复请求
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Ref 层：持有最新值供 transport body 回调 / 懒加载逻辑读取（避免 stale closure）
  const docRef = useRef(documentContext);
  const tierRef = useRef(tier);
  // 懒加载游标：当前页第一条消息的绝对 index，下次加载传 before=firstIndex
  const firstIndexRef = useRef<number>(0);
  // append 语义游标：记录已保存到后端的消息数量，saveSession 只发 slice(savedCount)
  const savedCountRef = useRef<number>(0);

  useEffect(() => {
    docRef.current = documentContext;
  }, [documentContext]);

  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        body: () => ({
          tier: tierRef.current,
          agentKey,
          // relatedMemories 字段已在 U6 废弃（恒空），不再传给后端
          entryContext: {
            source,
            sessionKey,
            document: docRef.current?.contentItemId
              ? {
                  contentItemId: docRef.current.contentItemId,
                  title: docRef.current.title,
                  bodyMarkdown: docRef.current.bodyMarkdown,
                }
              : undefined,
          },
        }),
      }),
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({ transport });
  /* eslint-enable react-hooks/refs */

  // 任务清单(钉在输入框上方的独立计划区):从消息流里取最近一次 write_tasks 的入参,实时反映。
  // 跳过 input-streaming(没传完,防闪);空数组生效(write_tasks([]) = 清空)。planTitle 由模型给。
  const { tasks, planTitle } = useMemo(() => {
    let t: SessionTask[] = [];
    let title: string | undefined;
    for (const m of messages) {
      for (const p of m.parts ?? []) {
        if (p.type !== 'tool-write_tasks') continue;
        const part = p as {
          state?: string;
          input?: { tasks?: SessionTask[]; title?: string };
        };
        if (part.state === 'input-streaming') continue;
        if (Array.isArray(part.input?.tasks)) {
          t = part.input.tasks;
          title = part.input.title;
        }
      }
    }
    return { tasks: t, planTitle: title };
  }, [messages]);

  // Aurora 改稿建议:从消息流里取最近一次 propose_edit 工具调用的 edits 数组,实时反映。
  // 跳过 input-streaming 防止数据未传完就落 suggestion;editsKey 用于上游去重,避免重复应用。
  // toolCallId 是 AI SDK 给每次工具调用的唯一 id,是最可靠的去重 key;fallback 用 m.id+长度。
  const { proposedEdits, editsKey } = useMemo(() => {
    let edits: Array<{ find: string; replace: string; reason: string }> = [];
    let key = '';
    for (const m of messages) {
      for (const p of m.parts ?? []) {
        if (p.type !== 'tool-propose_edit') continue;
        const part = p as {
          state?: string;
          toolCallId?: string;
          input?: { edits?: typeof edits };
        };
        if (part.state === 'input-streaming') continue;
        if (Array.isArray(part.input?.edits)) {
          edits = part.input.edits;
          key = part.toolCallId ?? `${m.id}:${edits.length}`;
        }
      }
    }
    return { proposedEdits: edits, editsKey: key };
  }, [messages]);

  /**
   * SessionLoad（初始加载）：取最近一页消息，初始化懒加载游标。
   *
   * savedCountRef 初始化为加载到的消息数（这批消息已在后端，不需再 append），
   * 这样首次回复后 savedCount=messages.length 时，slice(savedCount) 只截取新增的两条。
   *
   * setSessionReady(false) 放在异步回调外、通过 useState 初始值保证初始不 ready，
   * 不在 effect 同步调用 setState（lint: react-hooks/set-state-in-effect）。
   */
  useEffect(() => {
    let cancelled = false;
    loadSession(sessionKey)
      .then((data) => {
        if (cancelled) return;
        if (data.messages.length > 0) {
          setMessages(data.messages as unknown as UIMessage[]);
        }
        // 初始化懒加载游标（绝对 index，用于下次 before 参数）
        firstIndexRef.current = data.firstIndex;
        setHasMore(data.hasMore);
        // 初始化 append 游标：已加载的消息已在后端，不需再发送
        savedCountRef.current = data.messages.length;
        setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
    // sessionKey 变化才重新加载，documentContext 变化不触发（只用于首次 body）
  }, [sessionKey, setMessages]);

  /**
   * 懒加载更早历史（滚到顶触发）。
   *
   * 用 firstIndexRef 作游标（before=firstIndex），返回更早一页。
   * 旧页消息 prepend 到当前 messages 头部，用户无感分段。
   * savedCountRef 同步增加（prepend 的消息数量），保持 append 游标正确。
   */
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || firstIndexRef.current === 0) return;
    setIsLoadingMore(true);
    try {
      const data = await loadSession(sessionKey, { before: firstIndexRef.current });
      // prepend 老消息：新页在前，当前页接后（正序：旧→新）
      setMessages((prev) => [
        ...(data.messages as unknown as UIMessage[]),
        ...prev,
      ]);
      // 更新懒加载游标：指向更早一页的起点
      firstIndexRef.current = data.firstIndex;
      setHasMore(data.hasMore);
      // append 游标同步增加（prepend 的旧消息数），保证 saveSession 截取的是真正新增部分
      savedCountRef.current += data.messages.length;
    } catch {
      // 加载失败不崩溃，用户可重试（hasMore 保持，允许再次触发）
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, sessionKey, setMessages]);

  /**
   * AfterChat：回复完成后只追加本轮新增消息（方案A：前端 slice，后端纯 append）。
   *
   * savedCountRef 始终指向"已成功 append 到后端的消息数量"。
   * 每次 AI 回复结束，messages[savedCount..] 就是本轮新增的 user+assistant 消息。
   * 发送成功后才更新 savedCountRef，防止网络失败导致漏发。
   */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive =
      prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const nowReady = status === 'ready';
    prevStatusRef.current = status;

    if (wasActive && nowReady && messages.length > savedCountRef.current) {
      const newMessages = messages.slice(savedCountRef.current) as unknown as Record<string, unknown>[];
      const countToSave = savedCountRef.current + newMessages.length;
      void saveSession(sessionKey, newMessages).then(() => {
        // 只有后端成功 append 后才推进游标，保证重试安全
        savedCountRef.current = countToSave;
      });
    }
  }, [status, messages, sessionKey]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      void sendMessage({ text: t });
    },
    [sendMessage],
  );

  const cycleTier = useCallback(() => setTier((t) => TIER_NEXT[t]), []);

  const isStreaming = status === 'streaming' || status === 'submitted';

  return {
    messages,
    status,
    isStreaming,
    sessionReady,
    hasMore,
    isLoadingMore,
    loadMore,
    tasks,
    planTitle,
    proposedEdits,
    editsKey,
    tier,
    cycleTier,
    send,
    stop,
    error,
  };
}
