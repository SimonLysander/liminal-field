/*
 * ProseDraftEditor — 「文稿编辑」统一布局(笔记 / 文集条目共用)。
 *
 * 顶栏(返回 / 可编辑标题 / 自动保存状态 / 保存 / 提交浮层 / ⋯菜单)
 * + 三栏 grid(写作顾问 Aurora | 编辑器 | 大纲,自然相邻无分隔线)。
 *
 * 文稿编辑逻辑全在 useDraftEditor(传入的 editor controller);本组件只管布局与呈现。
 * agent 上下文是场景相关的,由调用方通过 advisor 注入(笔记=本篇 / 文集=本条目+脉络)。
 */

import { useCallback, useState } from 'react';
import { useSelectedText } from '@/hooks/use-selected-text';
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
import { PlateMarkdownEditor } from './PlateEditor';
import type { EditOutcome, ProposedEdit } from '@/pages/admin/lib/apply-proposed-edits';
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
  // 编辑器内当前选中文本(Cursor 式 add-to-chat):监听 Plate 编辑器 DOM 选区
  const selectedText = useSelectedText('[data-slate-editor]');

  // Aurora 改稿建议透传:AiAdvisorPanel 在 <Plate> context 外,拿不到 useEditorRef。
  // 通过回调把 propose_edit 的 edits 上抛到这里,再经 props 传给 PlateMarkdownEditor,
  // 后者在 <Plate> 内部通过 ProposedEditBridge 调用 useProposedEditController 落成 suggestion。
  const [pending, setPending] = useState<{ edits: ProposedEdit[]; key: string }>({ edits: [], key: '' });
  const handleProposedEdits = useCallback(
    (edits: ProposedEdit[], key: string) => setPending({ edits, key }),
    [],
  );

  // 改稿应用结果中转:PlateEditor 落痕迹后上报 outcomes(含失败项),透传给 AiAdvisorPanel,
  // 由聊天卡片按 toolCallId 匹配后标红失败项 —— 定位失败绝不静默。
  const [editOutcomes, setEditOutcomes] = useState<{ outcomes: EditOutcome[]; key: string }>({
    outcomes: [],
    key: '',
  });
  const handleOutcomes = useCallback(
    (outcomes: EditOutcome[], key: string) => setEditOutcomes({ outcomes, key }),
    [],
  );

  // 裁决完毕→干净正文回流:强制标脏(isUserEdit=true)触发自动保存,并随 hasPending 解除而解锁。
  // 裁决时焦点不在编辑器,onChange 会判"非用户编辑"漏存,故走 controller 主动回流这条路。
  const handleResolved = useCallback(
    (markdown: string) => editor.setBody(markdown, true),
    [editor],
  );

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
        // 三栏:顾问(Notion 风加宽 ~1:2.5)| 编辑器(弹性,内容居中收窄)| 大纲(窄)。无分隔线。
        gridTemplateColumns: 'clamp(20rem, 26vw, 30rem) minmax(0, 1fr) var(--layout-sidebar)',
        gridTemplateRows: '52px 1fr',
      }}
    >
      <ThresholdOverlay visible={editor.committing} label="正在提交版本..." />

      {/* ── Row 1: 顶栏(Notion 风格,无底边框) ── */}
      <div className="col-span-full flex items-center justify-between px-4">
        {/* 左:← + 可编辑标题 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
            style={{ color: 'var(--ink-faded)' }}
            onClick={editor.goBack}
            aria-label="返回"
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <input
            type="text"
            value={editor.state.title}
            onChange={(e) => editor.setField('title', e.target.value as TState['title'])}
            placeholder={titlePlaceholder}
            className="input-ghost min-w-[60px] max-w-[280px] truncate text-base font-medium placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        {/* 右:自动保存状态 + 保存(ghost) + 提交(中性胶囊→就近浮层) + ⋯菜单 */}
        <div className="flex items-center gap-1.5">
          {/* 自动保存状态:保存中(长春花紫呼吸点) / 已自动保存 hh:mm。不显示"未保存"。 */}
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

          {/* 保存:ghost 轻量,⇧⌘S */}
          <Button variant="ghost" size="default" className="text-base" onClick={() => void editor.saveDraft()} title="保存 ⇧⌘S">
            保存
          </Button>

          {/* 提交:secondary 中性胶囊,点开就近浮层(⌘S 也走 showCommitDialog) */}
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

          {/* 主题切换:沿用顶栏图标按钮风格(亮显 Sun / 暗显 Moon,CSS 切换) */}
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

          {/* ⋯ 菜单:丢弃草稿(危险) */}
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

      {/* ── Row 2 ── */}

      {/* [2,1] 写作顾问 Aurora;未启用留等宽空白保持三栏结构 */}
      {advisor?.enabled ? (
        <AiAdvisorPanel
          sessionKey={advisor.sessionKey}
          contentItemId={advisor.contentItemId}
          title={editor.state.title}
          bodyMarkdown={editor.state.bodyMarkdown}
          selectedText={selectedText}
          onProposedEdits={handleProposedEdits}
          outcomes={editOutcomes.outcomes}
          outcomesKey={editOutcomes.key}
        />
      ) : (
        <div />
      )}

      {/* [2,2] 编辑器 */}
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
              pendingEdits={pending.edits}
              editsKey={pending.key}
              onResolved={handleResolved}
              onOutcomes={handleOutcomes}
            />
          </DraftAssetProvider>
        </div>
      </div>

      {/* [2,3] 大纲 — 与展示端大纲同步(scroll-spy 高亮当前标题) */}
      <EditorOutline
        headings={editor.headings}
        onJump={editor.scrollToHeading}
        activeIndex={editor.activeHeadingIndex}
      />
    </div>
  );
}
