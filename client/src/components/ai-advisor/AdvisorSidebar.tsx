/**
 * AdvisorSidebar — 通用 AI 顾问侧栏(场景无关)。
 *
 * 外壳(会话管理 + 消息流 + 输入框 + 布局)全场景共用;场景差异只经四个口子进来:
 *   context             —— agent 知道什么(原样进 entryContext)
 *   agentKey/source     —— 连哪个后端入口
 *   renderToolCard —— 内联工具卡片:把某工具 part 渲染在消息流原位(拿 chat 自渲染+应用)
 *   editorBridge        —— 富文本编辑场景的可选适配(选区 chip + 改稿 overlay 桥接 + 审批态)
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Descendant } from 'platejs';
import { ArrowUp, ChevronDown, Pencil, Plus, Square, Trash2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { ChatSelectionAttachment } from '@/pages/admin/lib/live-chat-selection';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
import {
  deleteSession,
  listBusinessSessions,
  renameBusinessSession,
  type BusinessSessionSummary,
} from '@/services/agent';
import { skillsApi, type Skill } from '@/services/skills';
import { settingsApi } from '@/services/settings';
import {
  AiReferenceComposer,
  type AiReferenceComposerHandle,
} from './AiReferenceComposer';
import { MessageList } from './MessageList';
import { SkillSlashPopover } from './SkillSlashPopover';
import { TaskChecklist } from './TaskChecklist';
import {
  useAdvisorChat,
  type AdvisorChat,
  type AdvisorContext,
} from './use-advisor-chat';
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

/** 富文本编辑场景的可选适配:改稿 overlay 桥接 + 审批态。画廊等非编辑器场景不传。 */
export interface AdvisorEditorBridge {
  /** v3 改稿:获取当前 editor.children,供 computeDocDiff 使用。 */
  getEditorChildren: () => Descendant[];
  /** v3 改稿:获取当前 Plate editor 实例,供 deserializeMd 使用。 */
  getEditor: () => unknown;
  /** v3 改稿:最近 pendingProposal 变化时回调上层(交编辑器叠加审批)。 */
  onProposalChange: (proposal: Proposal | undefined) => void;
  /** 编辑器是否处于审批态 —— 顶栏据此加 accent 浅底。 */
  inApproval?: boolean;
}

export interface AdvisorSidebarProps {
  /** 会话标识,不透明字符串,调用方决定语义 */
  sessionKey: string;
  /** 草稿级 agent 实例标识(记忆/tasks/会话列表挂这里);缺省取 sessionKey。 */
  agentInstanceKey?: string;
  /** 后端 agent 入口标识,必填(通用件不偏向任何场景) */
  agentKey: string;
  /** entryContext.source 标记来源(如 'notes-editor' / 'gallery-editor') */
  source: string;
  /** 场景上下文(原样透传进 entryContext);各场景按需给 document / gallery / 未来字段。 */
  context?: AdvisorContext;
  /** 空状态问候(可选,缺省随机) */
  greeting?: string;
  /**
   * 内联工具卡片:把某个工具 part 渲染在消息流原位(如画廊 propose_caption 的应用卡片)。
   * 返回 null 则回退默认 ToolCallCard。拿 chat 读已解析的 proposals + 落地能力。
   */
  renderToolCard?: (part: unknown, chat: AdvisorChat) => ReactNode | null;
  /** 富文本编辑场景的可选适配(画廊等不传) */
  editorBridge?: AdvisorEditorBridge;
  /**
   * 已显式添加到聊天的引用 chip("Cursor 式 add-to-chat" / 报告页"追问"按钮)。
   * 升级出 editorBridge:不限编辑器场景——报告页选区追问也复用同一 chip 机制,
   * 用户心智里它就是"把这段加到对话上下文里"这一件事。chip 在输入框上方,
   * 发送瞬间拼成 markdown 引用块进 user text。
   */
  selectionAttachments?: ChatSelectionAttachment[];
  onRemoveSelectionAttachment?: (id: string) => void;
  /** chip 全清(发送后或会话切换时);上层可顺手做收尾(清高亮/重置选区 state)。 */
  onClearSelectedText?: () => void;
  /**
   * 可选关闭回调。传了的话, toolbar 末尾会渲染一个 X 按钮供用户关闭右栏。
   * 适配场景: digest 公开报告页(右栏可 toggle), 编辑页面想加关闭也能用同样钩子。
   */
  onClose?: () => void;
}

export function AdvisorSidebar({
  sessionKey,
  agentInstanceKey: agentInstanceKeyProp,
  agentKey,
  source,
  context,
  greeting: greetingProp,
  renderToolCard,
  editorBridge,
  selectionAttachments,
  onRemoveSelectionAttachment,
  onClearSelectedText,
  onClose,
}: AdvisorSidebarProps) {
  // 编辑器专属适配(改稿桥/审批态)解构,通用名维持以减小内部改动
  const {
    getEditorChildren,
    getEditor,
    onProposalChange,
    inApproval,
  } = editorBridge ?? {};

  const agentInstanceKey = agentInstanceKeyProp ?? sessionKey;
  const [currentSessionKey, setCurrentSessionKey] = useState(sessionKey);
  const [sessions, setSessions] = useState<BusinessSessionSummary[]>([]);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const composerRef = useRef<AiReferenceComposerHandle>(null);
  const currentSessionKeyRef = useRef(currentSessionKey);
  const hasPickedInitialSessionRef = useRef(false);
  const userControlledSessionRef = useRef(false);
  const [composerEmpty, setComposerEmpty] = useState(true);
  // 空状态问候:场景给了就用场景的,否则随机一句(只挑一次)
  const [fallbackGreeting] = useState(pickGreeting);
  const greeting = greetingProp ?? fallbackGreeting;
  // inline 会话重命名:renaming=true 时顶栏会话名变输入框(回车确认 / Esc 取消)
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 删除二次确认:dropdown 里点"删除"先变"确认删除?",再点才真删
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const chat = useAdvisorChat({
    sessionKey: currentSessionKey,
    agentInstanceKey,
    agentKey,
    source,
    context,
    onAfterSave: refreshSessions,
    getEditorChildren,
    getEditor,
  });
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
  } = chat;

  // 把 chat 绑进内联卡片渲染器,使 MessageList/ChatMessage 不需感知具体场景
  const renderToolCardBound = renderToolCard
    ? (part: unknown) => renderToolCard(part, chat)
    : undefined;

  // v3 改稿：pendingProposal 变化时通过 ref 回调上层。
  // 用 callId(字符串)作为依赖,避免 pendingProposal 对象引用每次新建(computeDocDiff
  // 的 hunks 含 random id,useMemo 每次重算都出新对象)触发死循环。
  // closure 仍能拿到最新 pendingProposal(callId 变化时才重新建 closure)。
  useEffect(() => {
    onProposalChangeRef.current?.(pendingProposal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只跟 callId,放 pendingProposal 自身会死循环
  }, [pendingProposal?.callId]);

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

  // 当前会话标题(顶栏显示 + inline 重命名初值)
  const currentTitle =
    ensureVisibleSession(sessions, currentSessionKey, agentInstanceKey).find(
      (s) => s.sessionKey === currentSessionKey,
    )?.title || '新会话';

  // 进入 inline 重命名:顶栏会话名变输入框,填入当前标题
  const startRename = useCallback(() => {
    setRenameValue(currentTitle);
    setRenaming(true);
  }, [currentTitle]);

  // 提交 inline 重命名(回车 / 失焦):空或未变则取消,否则落库
  const commitRename = useCallback(() => {
    const cleanTitle = renameValue.trim();
    setRenaming(false);
    if (!cleanTitle || cleanTitle === currentTitle) return;
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
  }, [agentInstanceKey, currentSessionKey, currentTitle, renameValue]);

  const cancelRename = useCallback(() => setRenaming(false), []);

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

  // ── Skill slash autocomplete(Phase 4 Task 4.1)──────────────────
  // 当前 agent 已启用 skills:从 settings.agentConfigs[agentKey].enabledSkillIds 推出。
  // 加载策略:挂载时一次性拉(全局 skills + 当前 agent 配置),AgentTab 改 enabledSkills
  // 时不会自动反映 —— 这是可接受的小代价(slash 不是关键操作链,用户进 Settings 改配置
  // 后随便关掉 advisor 重开就同步)。
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [agentEnabledSkillIds, setAgentEnabledSkillIds] = useState<string[]>([]);
  const [composerText, setComposerText] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);

  useEffect(() => {
    // 并行拉 skills 全集 + agent 配置;失败不影响 advisor 主链路,只是 slash 不可用。
    let aborted = false;
    Promise.all([skillsApi.list(), settingsApi.getAgentConfigs()])
      .then(([skills, configs]) => {
        if (aborted) return;
        setAllSkills(skills);
        const agentConfig = configs.find((c) => c.key === agentKey);
        setAgentEnabledSkillIds(agentConfig?.enabledSkillIds ?? []);
      })
      .catch((error) => {
        // 加载失败:slash 浮层不出即可,不报红
        // TODO: 项目 client logger 封装未落地,先用 console.warn,见 CLAUDE.md 日志准则
        console.warn(
          '[advisor] skills 加载失败,slash autocomplete 不可用',
          error,
        );
      });
    return () => {
      aborted = true;
    };
  }, [agentKey]);

  // 当前 agent 已启用 skills 列表(过滤掉已删但配置残留的)
  const enabledSkills = useMemo(
    () => allSkills.filter((s) => agentEnabledSkillIds.includes(s._id)),
    [allSkills, agentEnabledSkillIds],
  );

  // 文本变化时:判断是否以 / 开头(忽略前导空白),决定浮层开关。
  const handleComposerTextChange = useCallback((text: string) => {
    setComposerText(text);
    // 触发条件:文本去掉两侧空白后以 / 开头,且空白前不混内容(防 "hi /foo" 误触)。
    // 实际上 Plate composer 删干净再敲 / 就是首字符,稳定。
    const trimmed = text.trimStart();
    setSlashOpen(trimmed.startsWith('/'));
  }, []);

  // 选中 skill → composer 替换 + 关浮层 + 重新聚焦末尾
  const handlePickSkill = useCallback((skillName: string) => {
    composerRef.current?.replaceSlashCommand(skillName);
    setSlashOpen(false);
    composerRef.current?.focusEnd();
  }, []);

  const handleCloseSlash = useCallback(() => {
    setSlashOpen(false);
  }, []);

  return (
    // h-full:在笔记 grid 里等价于行 stretch(无变化);在文集条目 flex 容器里据此撑满高度
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶栏(48px,无边框,跟编辑器/大纲栏一条水平线)。
          - 会话名 DropdownMenu:列表切换 + 底部收纳"重命名/删除"(低频管理不平铺)
          - inline 重命名:renaming 时会话名变输入框(回车确认 / Esc / 失焦取消)
          - 新建是高频,独立 [+] 按钮留外面
          - 审批态加 accent 8% 浅底,跟左/中栏统一"审批模式"信号 */}
      <div
        className="flex h-[48px] shrink-0 items-center gap-1 px-3 transition-colors"
        style={{
          background: inApproval
            ? 'color-mix(in srgb, var(--accent) 8%, var(--paper))'
            : 'transparent',
        }}
      >
        {inApproval ? (
          // 审批态锁定:会话切换/新建/重命名/删除全禁用,只显示当前会话名(纯文字,不可点)
          // —— 审批是当前会话触发的,切走会语义错位(编辑器审批还在,advisor 却换会话)
          <span
            className="min-w-0 flex-1 truncate px-2 py-1 text-sm"
            style={{ color: 'var(--ink-ghost)' }}
            title="审批进行中,先处理完改稿再切换会话"
          >
            {currentTitle}
          </span>
        ) : renaming ? (
          <input
            type="text"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              // IME composition 中不响应 Enter/Esc — Windows IME 用 Enter 确认候选词，
              // 这里 preventDefault 会让候选词无法确认，用户感觉"按两次才行"。
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="input-ghost min-w-0 flex-1 truncate rounded-md px-2 py-1 text-sm"
            style={{ color: 'var(--ink-faded)', background: 'var(--shelf)' }}
            aria-label="重命名会话"
          />
        ) : (
          <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmingDelete(false); }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-sm outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none data-[state=open]:bg-[var(--shelf)]"
                style={{ color: 'var(--ink-faded)' }}
                aria-label="会话菜单"
                title="切换 / 管理会话"
              >
                <span className="min-w-0 flex-1 truncate">{currentTitle}</span>
                <ChevronDown size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              {ensureVisibleSession(sessions, currentSessionKey, agentInstanceKey).map((session) => (
                <DropdownMenuItem
                  key={session.sessionKey}
                  onClick={() => {
                    userControlledSessionRef.current = true;
                    hasPickedInitialSessionRef.current = true;
                    setCurrentSessionKey(session.sessionKey);
                  }}
                  style={
                    session.sessionKey === currentSessionKey
                      ? { color: 'var(--accent)', fontWeight: 500 }
                      : { color: 'var(--ink-faded)' }
                  }
                >
                  {session.title || '新会话'}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startRename} style={{ color: 'var(--ink-faded)' }}>
                <Pencil size={14} strokeWidth={1.5} />
                重命名当前
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  if (!confirmingDelete) {
                    e.preventDefault(); // 不关闭,先变确认态
                    setConfirmingDelete(true);
                  } else {
                    handleDeleteSession();
                  }
                }}
                className="[&_svg]:text-[var(--mark-red)]"
                style={{ color: 'var(--mark-red)' }}
              >
                <Trash2 size={14} strokeWidth={1.5} />
                {confirmingDelete ? '再点一次确认删除' : '删除当前'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={handleNewSession}
          disabled={inApproval}
          className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          style={{ color: 'var(--ink-ghost)' }}
          aria-label="新会话"
          title={inApproval ? '审批进行中,先处理完改稿' : '新会话'}
        >
          <Plus size={18} strokeWidth={1.5} />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
            style={{ color: 'var(--ink-ghost)' }}
            aria-label="关闭"
            title="关闭 (Esc)"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        )}
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
            renderToolCard={renderToolCardBound}
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

      {/* 输入区。relative 容器是 Skill slash 浮层的定位锚:浮层 absolute bottom-full
          会贴 composer 上沿弹出。 */}
      <div className="relative shrink-0 px-3 pb-4 pt-2">
        {/* Skill slash 浮层 — 锚定 composer 上沿。skills 空时组件自身返回 null,无开销。 */}
        <div className="absolute bottom-full left-3 right-3">
          <SkillSlashPopover
            open={slashOpen}
            skills={enabledSkills}
            query={composerText}
            onPick={handlePickSkill}
            onClose={handleCloseSlash}
          />
        </div>
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
            onTextChange={handleComposerTextChange}
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
