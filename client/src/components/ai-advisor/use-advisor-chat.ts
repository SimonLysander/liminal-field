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
 * 1. mount → loadSession(sessionKey,title) → 恢复对话(session 记忆脉络由后端注入,前端不再回传)
 * 2. send → transport body 携带 relatedMemories + entryContext(可选文档)
 * 3. 回复完成 → saveSession(sessionKey, messages)
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

  // Ref 层:持有最新值供 transport body 回调读取(transport 只创建一次)
  const docRef = useRef(documentContext);
  const tierRef = useRef(tier);
  const relatedMemoriesRef = useRef<
    Array<{ key: string; type: string; title: string; content: string }>
  >([]);

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
          relatedMemories:
            relatedMemoriesRef.current.length > 0
              ? relatedMemoriesRef.current
              : undefined,
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

  // SessionLoad:加载历史消息 + 自动 recall 记忆
  useEffect(() => {
    let cancelled = false;
    loadSession(sessionKey, documentContext?.title)
      .then((data) => {
        if (cancelled) return;
        relatedMemoriesRef.current = data.relatedMemories || [];
        if (data.messages.length > 0) {
          setMessages(data.messages as unknown as UIMessage[]);
        }
        setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
    // documentContext?.title 只用于首次 recall 提示,变化不需重载会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, setMessages]);

  // AfterChat:回复完成自动保存消息(tasks 显示由消息流里的 write_tasks 调用驱动,无需单独同步)
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive =
      prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const nowReady = status === 'ready';
    prevStatusRef.current = status;

    if (wasActive && nowReady && messages.length > 0) {
      void saveSession(sessionKey, messages as unknown as Record<string, unknown>[]);
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
    tasks,
    planTitle,
    tier,
    cycleTier,
    send,
    stop,
    error,
  };
}
