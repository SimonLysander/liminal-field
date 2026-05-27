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
import type { Descendant } from 'platejs';
import { deserializeMd } from '@platejs/markdown';
import { loadSession, saveSession, type SessionTask } from '@/services/agent';
import type { AnchorPayload } from '@/pages/admin/lib/serialize-anchor';
import type { ChatReferenceSnapshot } from '@/pages/admin/lib/live-chat-selection';
import type { PendingAiEdit } from '@/pages/admin/lib/use-ai-edit-controller';
import type { AiEditProposal } from '@/pages/admin/lib/ai-edit-proposal';
import { computeDocDiff } from '@/pages/admin/lib/compute-doc-diff';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
import {
  ReferenceRegistry,
  createEditSession,
  isEditConfirmation,
  isReferenceEditRequest,
  type EditSession,
} from './edit-session';
import type { ChatReferencesMetadata } from '@/pages/admin/lib/live-chat-selection';

export type Tier = 'flash' | 'standard' | 'think';

const TIER_NEXT: Record<Tier, Tier> = {
  flash: 'standard',
  standard: 'think',
  think: 'flash',
};

export interface UseAdvisorChatOptions {
  /** 会话标识,不透明字符串 */
  sessionKey: string;
  /** 草稿级 agent 实例标识；多个业务 session 共享这份记忆/tasks。 */
  agentInstanceKey?: string;
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
  /**
   * 当前编辑器锚点(selection/cursor)，随聊天 transport 传给后端。
   * 后端 prompt.handler 据此注入引用上下文；引用不默认等于编辑目标。
   */
  anchor?: AnchorPayload;
  /**
   * 发送时读取最新锚点。用于避免 selectionchange 高频 setState;
   * 若提供,transport body 优先读它,否则退回 anchorRef.current。
   */
  getAnchor?: () => AnchorPayload;
  /** 后端成功保存本轮新增消息后触发。用于刷新业务会话列表等持久化后动作。 */
  onAfterSave?: () => void;
  /**
   * v3 改稿：获取当前 editor.children，供 computeDocDiff 计算 hunks。
   * 由 AiAdvisorPanel 透传自 ProseDraftEditor。
   */
  getEditorChildren?: () => Descendant[];
  /**
   * v3 改稿：获取当前 Plate editor 实例，供 deserializeMd(editor, newMarkdown) 使用。
   * 由 AiAdvisorPanel 透传自 ProseDraftEditor。
   */
  getEditor?: () => unknown;
}

export function useAdvisorChat({
  sessionKey,
  agentInstanceKey,
  agentKey,
  source,
  documentContext,
  anchor,
  getAnchor,
  onAfterSave,
  getEditorChildren,
  getEditor,
}: UseAdvisorChatOptions) {
  const [tier, setTier] = useState<Tier>('standard');
  const [sessionReady, setSessionReady] = useState(false);

  // 懒加载状态：hasMore 控制是否显示"加载更多"触发区，isLoadingMore 防重复请求
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Ref 层：持有最新值供 transport body 回调 / 懒加载逻辑读取（避免 stale closure）
  const docRef = useRef(documentContext);
  const tierRef = useRef(tier);
  // anchorRef:与 docRef 同模式,避免 transport body 回调产生 stale closure
  const anchorRef = useRef<AnchorPayload>(anchor ?? { type: 'none' });
  const sessionKeyRef = useRef(sessionKey);
  const agentInstanceKeyRef = useRef(agentInstanceKey);
  const getAnchorRef = useRef(getAnchor);
  const onAfterSaveRef = useRef(onAfterSave);
  const lastSentEditAnchorRef = useRef<AnchorPayload | undefined>(undefined);
  const referenceRegistryRef = useRef(new ReferenceRegistry());
  const activeEditSessionRef = useRef<EditSession | undefined>(undefined);
  const sessionAppliedToolCallIdsRef = useRef<Set<string>>(new Set());
  // 懒加载游标：当前页第一条消息的绝对 index，下次加载传 before=firstIndex
  const firstIndexRef = useRef<number>(0);
  // append 语义游标：记录已保存到后端的消息数量，saveSession 只发 slice(savedCount)
  const savedCountRef = useRef<number>(0);

  useEffect(() => {
    docRef.current = documentContext;
  }, [documentContext]);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    agentInstanceKeyRef.current = agentInstanceKey;
  }, [agentInstanceKey]);

  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  useEffect(() => {
    anchorRef.current = anchor ?? { type: 'none' };
  }, [anchor]);

  useEffect(() => {
    getAnchorRef.current = getAnchor;
  }, [getAnchor]);

  useEffect(() => {
    onAfterSaveRef.current = onAfterSave;
  }, [onAfterSave]);


  /* eslint-disable react-hooks/refs */
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        body: () => buildAgentRequestBody({
          tier: tierRef.current,
          agentKey,
          source,
          sessionKey: sessionKeyRef.current,
          agentInstanceKey: agentInstanceKeyRef.current,
          documentContext: docRef.current,
        }),
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
          const lastUserMessage = [...messages]
            .reverse()
            .find((message) => message.role === 'user');
          const references = getReferencesFromMetadata(lastUserMessage?.metadata);
          const fallbackBody = body ?? {};
          const entryContext = {
            ...(fallbackBody.entryContext ?? {}),
            references: references.length > 0 ? references : fallbackBody.entryContext?.references,
            anchors: references.length > 0
              ? references.map((reference) => reference.anchor)
              : fallbackBody.entryContext?.anchors,
            anchor: references[0]?.anchor ?? fallbackBody.entryContext?.anchor,
          };
          return {
            body: {
              ...fallbackBody,
              id,
              messages,
              trigger,
              messageId,
              entryContext,
            },
          };
        },
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

  const proposalsByCallId = useMemo<Record<string, AiEditProposal>>(() => {
    const proposals: Record<string, AiEditProposal> = {};
    const liveMessages = messages.slice(savedCountRef.current);
    for (const m of liveMessages) {
      for (const p of m.parts ?? []) {
        if (p.type !== 'tool-rewrite_reference' && p.type !== 'tool-rewrite_document') {
          continue;
        }
        const part = p as {
          state?: string;
          toolCallId?: string;
          input?: { targetRefId?: string; newMarkdown?: string; reason?: string };
        };
        if (part.state === 'input-streaming') continue;
        const newText = part.input?.newMarkdown;
        if (typeof newText !== 'string' || newText.trim().length === 0) continue;
        const callId = part.toolCallId ?? `${m.id}:${p.type}`;
        if (p.type === 'tool-rewrite_document') {
          const oldText = docRef.current?.bodyMarkdown;
          if (!oldText) continue;
          proposals[callId] = {
            id: callId,
            title: '建议整篇改写',
            targetKind: 'document',
            oldText,
            newText,
            reason: part.input?.reason ?? '',
          };
        } else {
          const targetRefId = part.input?.targetRefId;
          const targetReference =
            referenceRegistryRef.current.get(targetRefId) ??
            activeEditSessionRef.current?.targets[0];
          const oldText = targetReference?.text;
          if (!oldText) continue;
          proposals[callId] = {
            id: callId,
            title: targetReference
              ? `建议修改${formatReferenceLocation(targetReference)}`
              : '建议修改引用',
            targetKind: 'reference',
            oldText,
            newText,
            reason: part.input?.reason ?? '',
            targetRefId,
            targetReference,
          };
        }
      }
    }
    return proposals;
  }, [messages]);

  /**
   * v3 改稿：监听 tool-propose_document_rewrite 工具调用，
   * 用 computeDocDiff 算出 hunks，产出 Proposal 对象。
   *
   * 与 v2 proposalsByCallId 并存（v2 监听 tool-rewrite_reference / tool-rewrite_document）；
   * Task 10 统一清旧时删 v2 路径。
   *
   * getEditorChildren / getEditor 直接作为 useMemo 依赖（render scope 里稳定），
   * 未传时静默返回空对象（上层 Task 8 接入后才有值）。
   */
  const v3ProposalsByCallId = useMemo<Record<string, Proposal>>(() => {
    const result: Record<string, Proposal> = {};
    if (!getEditorChildren || !getEditor) return result;

    for (const msg of messages) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        const partType = (part as { type?: string }).type;
        if (partType !== 'tool-propose_document_rewrite') continue;
        const state = (part as { state?: string }).state;
        if (state !== 'output-available') continue;
        const input = (part as { input?: { newMarkdown?: string; reason?: string } }).input;
        if (!input?.newMarkdown) continue;
        const callId =
          (part as { toolCallId?: string }).toolCallId ?? msg.id ?? '';
        try {
          const oldChildren = getEditorChildren();
          const editor = getEditor();
          const newChildren = deserializeMd(editor as never, input.newMarkdown) as Descendant[];
          const hunks = computeDocDiff(oldChildren, newChildren);
          result[callId] = {
            callId,
            newMarkdown: input.newMarkdown,
            reason: input.reason ?? '',
            hunks,
          };
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('[use-advisor-chat] propose_document_rewrite diff 失败', err);
          }
        }
      }
    }
    return result;
  }, [messages, getEditorChildren, getEditor]);

  /**
   * v3 改稿：最近一个 pending Proposal（无则 undefined）。
   * 上层通过 onProposalChange 回调拿到，透传给 ProposalOverlay / useProposalController。
   */
  const pendingProposal = useMemo<Proposal | undefined>(() => {
    const ids = Object.keys(v3ProposalsByCallId);
    return ids.length > 0 ? v3ProposalsByCallId[ids[ids.length - 1]] : undefined;
  }, [v3ProposalsByCallId]);

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
    setSessionReady(false);
    referenceRegistryRef.current = new ReferenceRegistry();
    activeEditSessionRef.current = undefined;
    sessionAppliedToolCallIdsRef.current.clear();
    lastSentEditAnchorRef.current = undefined;
    savedCountRef.current = 0;
    firstIndexRef.current = 0;
    setMessages([]);
    loadSession(sessionKey, { agentInstanceKey })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages as unknown as UIMessage[]);
        referenceRegistryRef.current.hydrateFromMessages(
          data.messages as Array<{ metadata?: unknown }>,
        );
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
  }, [agentInstanceKey, sessionKey, setMessages]);

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
      const data = await loadSession(sessionKey, {
        agentInstanceKey,
        before: firstIndexRef.current,
      });
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
  }, [agentInstanceKey, hasMore, isLoadingMore, sessionKey, setMessages]);

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
      void saveSession(sessionKey, newMessages, agentInstanceKey)
        .then(() => {
          // 只有后端成功 append 后才推进游标，保证重试安全
          savedCountRef.current = countToSave;
          onAfterSaveRef.current?.();
        })
        .catch((err) => {
          console.error('[agent-session] 保存会话失败', err);
        });
    }
  }, [agentInstanceKey, status, messages, sessionKey]);

  const send = useCallback(
    (
      text: string,
      options: {
        anchor?: AnchorPayload;
        anchors?: AnchorPayload[];
        references?: ChatReferenceSnapshot[];
      } = {},
    ) => {
      const t = text.trim();
      if (!t) return;
      // v2 edit session 逻辑保留（Task 10 才删）
      const explicitReferences = options.references ?? [];
      const sessionReferences =
        explicitReferences.length === 0 && isEditConfirmation(t)
          ? activeEditSessionRef.current?.targets ?? []
          : [];
      const referencesForThisSend =
        explicitReferences.length > 0 ? explicitReferences : sessionReferences;
      referenceRegistryRef.current.registerMany(referencesForThisSend);
      if (explicitReferences.length > 0 && isReferenceEditRequest(t)) {
        activeEditSessionRef.current = createEditSession(explicitReferences, 'references');
      } else if (!isEditConfirmation(t)) {
        activeEditSessionRef.current = undefined;
      }
      const anchorForThisSend =
        referencesForThisSend[0]?.anchor ??
        options.anchor ??
        getAnchorRef.current?.() ??
        anchorRef.current;
      lastSentEditAnchorRef.current = anchorForThisSend;
      void sendMessage({
        text: t,
        // v3 协议：chips 已拼进 text，不再通过 metadata.references 发送
        // v2 metadata.references 保留（Task 10 删）：
        metadata: explicitReferences.length
          ? { references: explicitReferences }
          : undefined,
      }, {
        // v3 transport body：只传 tier/agentKey/source/sessionKey/agentInstanceKey/entryContext.document
        // anchor/anchors/references 已从 body 移除（v3 协议，chips 拼进 text）
        body: buildAgentRequestBody({
          tier: tierRef.current,
          agentKey,
          source,
          sessionKey,
          agentInstanceKey,
          documentContext: docRef.current,
        }),
      });
    },
    [agentInstanceKey, agentKey, sendMessage, sessionKey, source],
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
    pending: undefined as PendingAiEdit | undefined,
    // v2 改稿（Task 10 删）
    proposalsByCallId,
    // v3 改稿
    v3ProposalsByCallId,
    pendingProposal,
    tier,
    cycleTier,
    send,
    stop,
    error,
  };
}

function getReferencesFromMetadata(metadata: unknown): ChatReferenceSnapshot[] {
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

function formatReferenceLocation(reference: ChatReferenceSnapshot): string {
  const anchor = reference.anchor;
  if (anchor.type !== 'range') return '引用';
  const start = anchor.startPath?.[0] ?? anchor.blockIndex;
  const end = anchor.endPath?.[0] ?? start;
  const from = Math.min(start, end) + 1;
  const to = Math.max(start, end) + 1;
  return from === to ? `第 ${from} 段` : `第 ${from}-${to} 段`;
}

function buildAgentRequestBody({
  tier,
  agentKey,
  source,
  sessionKey,
  agentInstanceKey,
  documentContext,
}: {
  tier: Tier;
  agentKey: string;
  source: string;
  sessionKey: string;
  agentInstanceKey?: string;
  documentContext?: UseAdvisorChatOptions['documentContext'];
}) {
  return {
    tier,
    agentKey,
    // relatedMemories 字段已在 U6 废弃（恒空），不再传给后端
    // v3 协议：anchor/anchors/references 字段已删，chips 拼进 user message text
    entryContext: {
      source,
      sessionKey,
      agentInstanceKey,
      document: documentContext?.contentItemId
        ? {
            contentItemId: documentContext.contentItemId,
            title: documentContext.title,
            bodyMarkdown: documentContext.bodyMarkdown,
          }
        : undefined,
    },
  };
}
