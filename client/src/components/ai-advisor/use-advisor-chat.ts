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
 * 1. mount → loadSession(sessionKey) → 恢复对话（首屏加载最近一页，仅供渲染）
 *    session 记忆脉络由后端注入 system prompt，前端不管
 * 2. 滚到顶懒加载 → loadSession(sessionKey, { before: firstIndex }) → 前拼更早消息
 * 3. send → transport 只发末条 message，历史与持久化全由后端负责(后端权威上下文)
 * 4. 回复完成(status→ready) → 通知上层刷新会话列表(onAfterSave)，不再发送任何消息
 *
 * 分段聚合分页设计：
 * - 持久化由后端 onFinish 接管(append-only)，前端不再 PUT，无 savedCountRef
 * - firstIndexRef 记录懒加载游标，onLoadMore 时传 before=firstIndex
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
import { loadSession, type SessionTask } from '@/services/agent';
import { computeDocDiff } from '@/pages/admin/lib/compute-doc-diff';
import { readResolved, markResolved } from '@/pages/admin/lib/resolved-store';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
// edit-session 现仅保留 ReferenceRegistry（渲染层读取历史 references 用于 chip 展示）
// createEditSession / isEditConfirmation / isReferenceEditRequest 已随 v2 send 逻辑一并删除

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
    /** 文集场景的整集脉络(标题/描述+条目列表+当前位置);笔记不传 */
    collectionContext?: string;
  };
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
  const sessionKeyRef = useRef(sessionKey);
  const agentInstanceKeyRef = useRef(agentInstanceKey);
  const onAfterSaveRef = useRef(onAfterSave);
  // 懒加载游标：当前页第一条消息的绝对 index，下次加载传 before=firstIndex
  const firstIndexRef = useRef<number>(0);

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
    onAfterSaveRef.current = onAfterSave;
  }, [onAfterSave]);


   
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
          // 后端权威上下文:历史由后端从 agent_sessions 读,前端只发最新这条,
          // 请求体不再随对话变长。chips 已拼进 user message text。
          const fallbackBody = body ?? {};
          return {
            body: {
              ...fallbackBody,
              id,
              message: messages[messages.length - 1],
              trigger,
              messageId,
            },
          };
        },
      }),
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({ transport });
   

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
  // 已裁决 callId 跳过:防"接受/拒绝后刷新页面 → 又重新进入审批"。
  // resolved-store 用全局 localStorage 持久化(callId 全局唯一,无需 per-session)。
  const v3ProposalsByCallId = useMemo<Record<string, Proposal>>(() => {
    const result: Record<string, Proposal> = {};
    if (!getEditorChildren || !getEditor) return result;

    const resolvedSet = readResolved();

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
        if (resolvedSet.has(callId)) continue;
        // stale/invalid:服务器拒绝了这个 propose(bodyHash 不匹配 / 缺失 / 无文档)。
        // 模型在同 turn 已收到提示会重新 propose(新 callId);这里把当前作废,
        // 避免拉起伪审批。仍 markResolved 保证刷新后也不再被 v3ProposalsByCallId 算出。
        //
        // 注:server `toolResult` 返 JSON.stringify 字符串(propose 工具未声明 outputSchema,
        // AI SDK 不会自动反序列化),status 实际路径是 JSON.parse(output).meta.status。
        // 兼容未来加 outputSchema 切到结构化对象的情况:object 路径也读 meta.status。
        const rawOutput = (part as { output?: unknown }).output;
        let proposeStatus: string | undefined;
        if (typeof rawOutput === 'string') {
          try {
            proposeStatus = (JSON.parse(rawOutput) as { meta?: { status?: string } })
              .meta?.status;
          } catch {
            /* 非 JSON,走正常 diff 路径 */
          }
        } else if (rawOutput && typeof rawOutput === 'object') {
          proposeStatus = (rawOutput as { meta?: { status?: string } }).meta?.status;
        }
        if (proposeStatus === 'stale' || proposeStatus === 'invalid') {
          markResolved(callId);
          continue;
        }
        try {
          const oldChildren = getEditorChildren();
          const editor = getEditor();
          const newChildren = deserializeMd(editor as never, input.newMarkdown) as Descendant[];
          const hunks = computeDocDiff(oldChildren, newChildren);
          // hunks 为空(editor 已等于 newMarkdown):自动标 resolved + 跳过
          if (hunks.length === 0) {
            markResolved(callId);
            continue;
          }
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
   * setSessionReady(false) 和 setMessages([]) 通过 queueMicrotask 推迟到异步微任务，
   * 避免在 effect 同步体内直接 setState（react-hooks/set-state-in-effect）。
   */
  useEffect(() => {
    let cancelled = false;
    firstIndexRef.current = 0;
    // 推迟 setState 到微任务，避免在 effect 同步体内调用（react-hooks/set-state-in-effect）
    queueMicrotask(() => {
      if (cancelled) return;
      setSessionReady(false);
      setMessages([]);
    });
    loadSession(sessionKey, { agentInstanceKey })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages as unknown as UIMessage[]);
        // 初始化懒加载游标（绝对 index，用于下次 before 参数）
        firstIndexRef.current = data.firstIndex;
        setHasMore(data.hasMore);
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
    } catch {
      // 加载失败不崩溃，用户可重试（hasMore 保持，允许再次触发）
    } finally {
      setIsLoadingMore(false);
    }
  }, [agentInstanceKey, hasMore, isLoadingMore, sessionKey, setMessages]);

  /**
   * 一轮对话结束(active→ready)后通知上层刷新会话列表(标题/排序)。
   * 持久化已由后端 onFinish 接管,这里不再发送任何消息(后端权威上下文)。
   */
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive =
      prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const nowReady = status === 'ready';
    prevStatusRef.current = status;
    if (wasActive && nowReady) {
      onAfterSaveRef.current?.();
    }
  }, [status]);

  // 用 ref 跟踪当前所有 active(未 resolved)proposal callId,发新 prompt 时一次性 mark resolved
  // (= 用户"忽略"模式:没点 ✓✗ 就发新 prompt,旧 proposal 应当作废)
  const activeProposalCallIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    activeProposalCallIdsRef.current = new Set(Object.keys(v3ProposalsByCallId));
  }, [v3ProposalsByCallId]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // 发新 prompt 时:把当前 active proposal 标 resolved(用户忽略上一个,不希望它继续干扰下一轮)
      activeProposalCallIdsRef.current.forEach((cid) => markResolved(cid));
      // v3 协议：chips 已拼进 text，不传 metadata.references；transport body 不传 anchor/anchors
      void sendMessage({ text: t }, {
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
    // v3 改稿
    proposalsByCallId: v3ProposalsByCallId,
    pendingProposal,
    tier,
    cycleTier,
    send,
    stop,
    error,
  };
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
            collectionContext: documentContext.collectionContext,
          }
        : undefined,
    },
  };
}
