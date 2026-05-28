/*
 * ProseDraftEditor — 「文稿编辑」统一布局(笔记 / 文集条目共用)。
 *
 * 顶栏(返回 / 可编辑标题 / 自动保存状态 / 保存 / 提交浮层 / ⋯菜单)
 * + 三栏 grid(写作顾问 Aurora | 编辑器 | 大纲,自然相邻无分隔线)。
 *
 * 文稿编辑逻辑全在 useDraftEditor(传入的 editor controller);本组件只管布局与呈现。
 * agent 上下文是场景相关的,由调用方通过 advisor 注入(笔记=本篇 / 文集=本条目+脉络)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Sun, Moon, Trash2, MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/hooks/use-theme';
import { LoadingState } from '@/components/LoadingState';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';
import { AiAdvisorPanel } from '@/components/ai-advisor/AiAdvisorPanel';
import { PlateMarkdownEditor, type EditorBridgeHandle, type ProposalUiState } from './PlateEditor';
import type { Proposal } from '@/pages/admin/lib/use-proposal-controller';
import type { ChatSelectionAttachment } from '@/pages/admin/lib/live-chat-selection';
import { EditorOutline } from './EditorOutline';
import { CommitForm } from './CommitForm';
import type { BaseDraftState, DraftEditorController } from '../lib/use-draft-editor';

/** 顾问栏注入:启用开关 + 会话/文档标识(title/正文由布局从 editor.state 实时取) */
export interface AdvisorMount {
  enabled: boolean;
  sessionKey: string;
  /** 文档标识(笔记=contentItemId;文集条目=`anthologyId:entryKey`);用于记忆绑定/document context */
  contentItemId: string;
}

export interface ProseDraftEditorProps<TState extends BaseDraftState> {
  editor: DraftEditorController<TState>;
  /** DraftAssetProvider 的 scope id(笔记=id;文集=anthologyId) */
  draftScopeId: string;
  /** PlateEditor 的 key(切换文档时重建编辑器) */
  editorKey: string;
  titlePlaceholder?: string;
  /** 写作顾问(可选);未启用则左栏留等宽空白,保持三栏结构 */
  advisor?: AdvisorMount;
}

export function ProseDraftEditor<TState extends BaseDraftState>({
  editor,
  draftScopeId,
  editorKey,
  titlePlaceholder = '无标题',
  advisor,
}: ProseDraftEditorProps<TState>) {
  const { theme, setTheme } = useTheme();
  // Cursor 式 add-to-chat:拖选只产生选区;点击浮动工具栏「添加到聊天」后才写入这里。
  // 保存 live range attachment:chip 展示初始 preview;发送/高亮时读取当前 range。
  const [chatSelections, setChatSelections] = useState<ChatSelectionAttachment[]>([]);
  const chatSelectionsRef = useRef<ChatSelectionAttachment[]>([]);

  // ── v3 改稿透传链 ────────────────────────────────────────────────────────────
  // editor 桥 ref：由 PlateMarkdownEditor 内部的 EditorChildrenBridge 填充；
  // getEditorChildren/getEditor 供 use-advisor-chat computeDocDiff / deserializeMd 使用。
  const editorBridgeRef = useRef<EditorBridgeHandle | null>(null);

  // 来自聊天侧上抛的 pending proposal(含 newMarkdown + reason + hunks)
  const [v3PendingProposal, setV3PendingProposal] = useState<Proposal | undefined>(undefined);

  // 审批 UI state:进入审批时由 PlateEditor 上抛,中间栏顶栏据此切换为审批控件
  // 仅记 count(用于显示统计);acceptAll/rejectAll 是 PlateEditor 提供的稳定代理
  // (内部走 controllerRef.current),保存到 ref 不引起 ProseDraftEditor 重渲染。
  const [proposalUi, setProposalUi] = useState<{ pendingCount: number; totalCount: number } | null>(null);
  const proposalActionsRef = useRef<{ acceptAll: () => void; rejectAll: () => void }>({
    acceptAll: () => {},
    rejectAll: () => {},
  });
  const handleProposalUiChange = useCallback((state: ProposalUiState | null) => {
    if (state) {
      setProposalUi({ pendingCount: state.pendingCount, totalCount: state.totalCount });
      proposalActionsRef.current = { acceptAll: state.acceptAll, rejectAll: state.rejectAll };
    } else {
      setProposalUi(null);
      proposalActionsRef.current = { acceptAll: () => {}, rejectAll: () => {} };
    }
  }, []);

  // 给 AiAdvisorPanel 的 getter:从桥 ref 读取，ref 空时降级返回空数组/undefined
  const getEditorChildren = useCallback(
    () => editorBridgeRef.current?.getChildren() ?? [],
    [],
  );
  const getEditor = useCallback(
    () => editorBridgeRef.current?.getEditor(),
    [],
  );

  // AiAdvisorPanel 上抛 pendingProposal 时落到 state
  const handleProposalChange = useCallback((p: Proposal | undefined) => {
    setV3PendingProposal(p);
  }, []);

  // v3 所有 hunks 裁决完后：和 v2 路径一样，走 controller.setBody 强制标脏触发保存
  const handleV3Resolved = useCallback(
    (markdown: string) => editor.setBody(markdown, true),
    [editor],
  );
  // ──────────────────────────────────────────────────────────────────────────────

  const clearChatSelections = useCallback(() => {
    setChatSelections((prev) => {
      prev.forEach((selection) => selection.dispose());
      chatSelectionsRef.current = [];
      return [];
    });
  }, []);

  const removeChatSelection = useCallback((id: string) => {
    setChatSelections((prev) => {
      const removed = prev.find((selection) => selection.id === id);
      removed?.dispose();
      const next = prev.filter((selection) => selection.id !== id);
      chatSelectionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      chatSelectionsRef.current.forEach((selection) => selection.dispose());
      chatSelectionsRef.current = [];
    };
  }, []);

  if (editor.loading) {
    return <LoadingState variant="full" />;
  }

  // 加载彻底失败(没成功读到任何内容)→ 全屏错误;加载成功后的保存类错误走顶部错误条
  if (editor.error && !editor.loaded) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3" style={{ background: 'var(--paper)' }}>
        <p className="text-base" style={{ color: 'var(--mark-red)' }}>{editor.error}</p>
        <button className="text-base" style={{ color: 'var(--ink-faded)' }} onClick={editor.goBack}>
          返回管理后台
        </button>
      </div>
    );
  }

  return (
    <div
      className="grid h-screen overflow-hidden"
      style={{
        background: 'var(--paper)',
        // 三栏(新):大纲(窄,左)| 编辑器(弹性,中,内容居中)| 顾问 Aurora(右,~26vw)。
        // 设计语言:各栏独立 52px 顶栏(无 borderBottom 横跨,跟 Notion 派对位),
        // 视线流自然递进 "结构 → 内容 → 对话"。返回按钮落在大纲栏顶左 = 真窗口左上角。
        gridTemplateColumns: 'var(--layout-sidebar) minmax(0, 1fr) clamp(20rem, 26vw, 30rem)',
        gridTemplateRows: '48px 1fr',
      }}
    >
      <ThresholdOverlay visible={editor.committing} label="正在提交版本..." />

      {/* ── Row 1: 三栏各自独立顶栏(均 52px,无 borderBottom,跟 Notion 派对齐)──
          [1,1] 大纲栏顶栏:返回按钮 + "大纲" label —— 返回挂这里 = 真窗口左上角
          [1,2] 编辑器栏顶栏:标题输入框 + 自动保存 + 保存 + 提交 + 主题 + ⋯
          [1,3]+[2,3] AiAdvisorPanel 占整列(row-span 2),自管内部 header + 内容流 */}

      {/* [1,1] 大纲栏顶栏:返回 + 文档标题(标题挪到这里 — 跟返回按钮一组,符合 iOS 导航
          "[← 上级] 当前页"的心智;原 "大纲" label 删掉,大纲是辅助导航不需要 label 重复)。
          审批态加 accent 8% 浅底 → 跟 [1,2] 同色,**整条**形成"审批模式"视觉信号。 */}
      <div
        className="flex items-center gap-1.5 px-3 transition-colors"
        style={{
          background: proposalUi
            ? 'color-mix(in srgb, var(--accent) 8%, var(--paper))'
            : 'transparent',
        }}
      >
        <button
          className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
          style={{ color: 'var(--ink-faded)' }}
          onClick={editor.goBack}
          aria-label="返回"
          title="返回"
        >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </button>
        <input
          type="text"
          value={editor.state.title}
          onChange={(e) => editor.setField('title', e.target.value as TState['title'])}
          placeholder={titlePlaceholder}
          className="input-ghost min-w-0 flex-1 truncate text-sm font-medium placeholder:text-[var(--ink-ghost)]"
          style={{ color: 'var(--ink-faded)' }}
        />
      </div>

      {/* [1,2] 编辑器栏顶栏 — 正常态 vs 审批态切换内容。审批态加 accent 8% 浅底
          + 内容居中收窄到跟编辑段落同宽(用 Plate Editor 同 padding 表达式)。
          按钮 ghost 风格(小而精致,无大边框,hover 才有色块提示)。*/}
      {proposalUi ? (
        <div
          className="flex w-full transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--accent) 8%, var(--paper))',
          }}
        >
          <div className="mx-auto flex w-full max-w-[var(--layout-editor-max)] items-center justify-between gap-3 whitespace-nowrap px-16 sm:px-[max(64px,calc(50%-350px))]">
            {/* 左:人话统计 + 克制的快捷键提示。
                快捷键:11px,全 ink-ghost 同色(不用符号深字浅的对比 → 那个对比反而显眼),
                极淡不抢视觉,需要时瞥一眼能看到 */}
            <div className="flex items-baseline gap-3 text-sm">
              <span style={{ color: 'var(--ink-faded)' }}>
                {proposalUi.totalCount - proposalUi.pendingCount > 0 ? (
                  <>
                    还剩 <strong style={{ color: 'var(--accent)' }}>{proposalUi.pendingCount}</strong> 处 · 已确认{' '}
                    {proposalUi.totalCount - proposalUi.pendingCount}
                  </>
                ) : (
                  <>
                    <strong style={{ color: 'var(--accent)' }}>{proposalUi.pendingCount}</strong> 处待确认
                  </>
                )}
              </span>
              {/* Claude 风:一行 · 分隔的极淡提示(Type to search · Space to toggle …)*/}
              <span
                className="hidden lg:inline"
                style={{ color: 'var(--ink-ghost)', fontSize: 11 }}
              >
                ↑↓ 浏览 · ⏎ 接受 · ⌫ 拒绝
              </span>
            </div>
            {/* 右:ghost 风格按钮 — 默认透明无边框,hover 才显色块。
                拒绝 = mark-red ghost / 接受 = accent (长春花紫) ghost
                跟项目其它顶栏按钮风格一致(小而精致,无重边框)*/}
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => proposalActionsRef.current.rejectAll()}
                aria-label="拒绝全部改动"
                className="rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--mark-red)_10%,transparent)]"
                style={{ color: 'var(--mark-red)' }}
              >
                拒绝全部
              </button>
              <button
                type="button"
                onClick={() => proposalActionsRef.current.acceptAll()}
                aria-label="接受全部改动"
                className="rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                style={{ color: 'var(--accent)', fontWeight: 500 }}
              >
                接受全部
              </button>
            </div>
          </div>
        </div>
      ) : (
        // 正常态:标题已挪到大纲栏,这里只剩自动保存 + 保存/提交/主题/⋯ 全部右对齐
        <div className="flex min-w-0 items-center justify-end px-4">
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
              {editor.isAutosaving && (
                <span
                  className="size-1.5 shrink-0 animate-pulse rounded-full [animation-duration:1.2s]"
                  style={{ background: 'var(--accent)' }}
                  aria-hidden
                />
              )}
              {editor.isAutosaving
                ? '保存中…'
                : editor.lastSavedAt
                  ? `已自动保存 ${new Date(editor.lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
            </span>
            {editor.autosaveError && (
              <span className="text-xs" style={{ color: 'var(--mark-red)' }}>{editor.autosaveError}</span>
            )}

            <Button variant="ghost" size="default" className="text-base" onClick={() => void editor.saveDraft()} title="保存 ⇧⌘S">
              保存
            </Button>

            <Popover open={editor.showCommitDialog} onOpenChange={editor.setShowCommitDialog}>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="default" className="text-base">提交</Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
                <CommitForm
                  changeNote={editor.state.changeNote}
                  onChangeNote={(v) => editor.setField('changeNote', v as TState['changeNote'])}
                  onConfirm={() => void editor.commitDraft()}
                  onCancel={() => editor.setShowCommitDialog(false)}
                />
              </PopoverContent>
            </Popover>

            <button
              className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}
              aria-label="切换主题"
              title="切换主题"
            >
              <Sun size={18} strokeWidth={1.5} className="theme-icon-light" />
              <Moon size={18} strokeWidth={1.5} className="theme-icon-dark" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none data-[state=open]:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-ghost)' }}
                  title="更多"
                >
                  <MoreHorizontal size={18} strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => void editor.discardDraft()}
                  className="text-[var(--danger)] focus:bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] [&_svg]:text-[var(--danger)]"
                >
                  <Trash2 />丢弃草稿
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* [2,1] 大纲面板 — 顶栏的 "大纲" label 已挪到 [1,1],面板内部只剩标题树 */}
      <EditorOutline
        headings={editor.headings}
        onJump={editor.scrollToHeading}
        activeIndex={editor.activeHeadingIndex}
      />

      {/* [2,2] 编辑器内容 */}
      <div className="min-w-0 overflow-y-auto overflow-x-hidden" data-scroll-container>
        {editor.error && editor.loaded && (
          <div className="px-6 py-2" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{editor.error}</p>
          </div>
        )}
        <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-40">
          <DraftAssetProvider contentItemId={draftScopeId}>
            <PlateMarkdownEditor
              key={editorKey}
              initialMarkdown={editor.state.bodyMarkdown}
              onChange={editor.setBody}
              onAddSelectionToChat={(attachment) =>
                setChatSelections((prev) => {
                  const next = [...prev, attachment];
                  chatSelectionsRef.current = next;
                  return next;
                })
              }
              v3Proposal={v3PendingProposal}
              onV3Resolved={handleV3Resolved}
              onProposalUiChange={handleProposalUiChange}
              editorRefSync={editorBridgeRef}
            />
          </DraftAssetProvider>
        </div>
      </div>

      {/* [1,3]+[2,3] AiAdvisorPanel 独占第三列(row-span 2),内部自管顶栏 + 消息流 */}
      {advisor?.enabled ? (
        <div style={{ gridColumn: 3, gridRow: '1 / span 2', minHeight: 0 }}>
          <AiAdvisorPanel
            sessionKey={advisor.sessionKey}
            contentItemId={advisor.contentItemId}
            title={editor.state.title}
            bodyMarkdown={editor.state.bodyMarkdown}
            selectionAttachments={chatSelections}
            onRemoveSelectionAttachment={removeChatSelection}
            onClearSelectedText={clearChatSelections}
            onProposalChange={handleProposalChange}
            getEditorChildren={getEditorChildren}
            getEditor={getEditor}
            inApproval={!!proposalUi}
          />
        </div>
      ) : (
        <div style={{ gridColumn: 3, gridRow: '1 / span 2' }} />
      )}
    </div>
  );
}
