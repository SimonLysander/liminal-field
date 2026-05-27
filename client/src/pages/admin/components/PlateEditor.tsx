/*
 * PlateMarkdownEditor — Markdown 驱动的富文本编辑器
 *
 * 工具栏通过 React Portal 渲染到外部 DOM 容器（由 toolbarContainer prop 指定），
 * 使工具栏能出现在页面顶栏区域，同时保持 Plate 上下文可用。
 *
 * Markdown 双向转换：
 *   - 初始化时 deserializeMd 将 Markdown 转为 Plate 节点树
 *   - 编辑时 serializeMd 将节点树序列化回 Markdown
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAiEditController, type PendingAiEdit } from '@/pages/admin/lib/use-ai-edit-controller';
import type { AiEditOutcome } from '@/pages/admin/lib/apply-ai-edit';
import { AlertTriangle, Check, PencilLine, X } from 'lucide-react';
import {
  normalizeProposalText,
  type AiEditProposal,
  type AiEditProposalOutcome,
} from '@/pages/admin/lib/ai-edit-proposal';
import { failureText } from '@/components/ai-advisor/ProposalDiff';
import { serializeAnchor, type AnchorPayload, type AnchorRange } from '@/pages/admin/lib/serialize-anchor';
import {
  createLiveChatSelectionAttachment,
  type ChatSelectionAttachment,
  type LiveSelectionEditor,
} from '@/pages/admin/lib/live-chat-selection';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import { NodeApi } from 'platejs';
import {
  Plate,
  usePlateEditor,
  useEditorRef,
  useEditorSelector,
} from 'platejs/react';
import { serializeMd, deserializeMd } from '@platejs/markdown';
// v3 改稿依赖
import { useProposalController, type Proposal } from '@/pages/admin/lib/use-proposal-controller';
import { ProposalOverlay } from '@/components/ai-advisor/ProposalOverlay';
import { ProposalToolbar } from '@/components/ai-advisor/ProposalToolbar';
import type { Hunk } from '@/pages/admin/lib/compute-doc-diff';

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
import { EditorKit } from '@/components/editor/editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { FloatingToolbarButtons } from '@/components/ui/floating-toolbar-buttons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDraftAssetContext } from '@/contexts/DraftAssetContext';

/**
 * AnchorBridge — 在 <Plate> context 内细粒度订阅 selection，序列化为 AnchorPayload 后上抛。
 *
 * 为什么需要单独子组件：useEditorRef / useEditorSelector 必须在 <Plate> context 内调用。
 * 通过 useEditorSelector 订阅 selection，仅在 selection 真正变化时触发回调，避免全量重渲染。
 */
function AnchorBridge({
  onAnchorChange,
}: {
  onAnchorChange: (a: AnchorPayload) => void;
}) {
  const editor = useEditorRef();
  // useEditorSelector 监听 selection 变化，返回值不变则不触发重渲染
  const anchor = useEditorSelector(
    (e) =>
      serializeAnchor(
        e.children as Parameters<typeof serializeAnchor>[0],
        e.selection as Parameters<typeof serializeAnchor>[1],
      ),
    [],
  );

  useEffect(() => {
    onAnchorChange(anchor);
  }, [anchor, onAnchorChange]);

  // 消费 editor 变量防止 unused-variable lint 警告（useEditorRef 在 AnchorBridge 里不直接用，但未来扩展时可能需要）
  void editor;

  return null;
}

/**
 * AiEditBridge — v2 改稿在 <Plate> context 内的总控 + 顶部审阅操作条渲染。
 *
 * 为什么独立子组件:useAiEditController 内部用 useEditorRef + useEditorSelector,
 * 必须在 <Plate> context 内调用。PlateMarkdownEditor 的父级在 <Plate> 外,故所有
 * editor 交互在此聚合。
 *
 * 与 AnchorBridge 关系:平行,互不依赖。AnchorBridge 只负责把 anchor 上抛给父层(供
 * 聊天 transport);AiEditBridge 内重新订阅一次 selection 算 anchor(applyAiEdit 需要)。
 * useEditorSelector 是细粒度订阅,代价小,不合并两个 Bridge 是因为职责清晰、解耦更好——
 * AnchorBridge 服务"transport 发送",AiEditBridge 服务"editor 应用",生命周期可能未来分叉。
 *
 * 状态流转:pending(新 callId)→ applyAiEdit 落 suggestion → hasPending=true 上报锁定;
 * 全部接受/拒绝 → controller serializeMd 干净正文回流 onResolved → 父层 setBody 触发保存。
 */
function AiEditBridge({
  pending,
  onResolved,
  onHasPendingChange,
  onOutcomesByCallIdChange,
}: {
  pending?: PendingAiEdit;
  onResolved?: (md: string) => void;
  onHasPendingChange?: (h: boolean) => void;
  onOutcomesByCallIdChange?: (m: Record<string, AiEditOutcome>) => void;
}) {
  // Bridge 内重新订阅 selection 算 anchor —— 和 AnchorBridge 平行,职责解耦
  const anchor = useEditorSelector(
    (e) =>
      serializeAnchor(
        e.children as Parameters<typeof serializeAnchor>[0],
        e.selection as Parameters<typeof serializeAnchor>[1],
      ),
    [],
  );

  const { outcomesByCallId, acceptAll, rejectAll } = useAiEditController(
    pending,
    anchor,
    onResolved,
  );

  // hasPending **实时跟编辑器真实 suggestion 节点数**,不依赖 controller state。
  // 为什么不用 controller.hasPending:resolveAll 里 setHasPending(false) 一旦因
  // 某个边缘 catch / 异步时序没穿透 → 编辑器永远卡在 readOnly,用户选不动也打不动。
  // 用 useEditorSelector 实时跟,有 suggestion 必锁定,没有就立刻解锁——状态机不可能卡死。
  const hasPending = useEditorSelector(
    (e) => e.getApi(SuggestionPlugin).suggestion.nodes({ at: [] }).length > 0,
    [],
  );

  useEffect(() => {
    onHasPendingChange?.(hasPending);
  }, [hasPending, onHasPendingChange]);

  // outcomes 变化上报 → 父层中转,Task 7 由 AiAdvisorPanel 卡片按 callId 查询
  useEffect(() => {
    onOutcomesByCallIdChange?.(outcomesByCallId);
  }, [outcomesByCallId, onOutcomesByCallIdChange]);

  // 无未决 suggestion → 不渲染操作条
  if (!hasPending) return null;

  // 顶部审阅操作条:沿用 v1 视觉规格(accent 软底 + 长春花紫主按钮 + ghost 拒绝)。
  // sticky 贴顶,防滚动后失去裁决入口。
  return (
    <div
      className="sticky top-0 z-10 mb-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
      style={{
        background: 'color-mix(in srgb, var(--accent) 8%, var(--paper))',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
      }}
    >
      <span className="text-sm" style={{ color: 'var(--ink)' }}>
        Aurora 提议了修改，请逐处或全部裁决后继续编辑
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={rejectAll}
          className="rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-faded)' }}
        >
          全部拒绝
        </button>
        <button
          onClick={acceptAll}
          className="rounded-md px-2.5 py-1 text-sm transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          全部接受
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// v3 ProposalBridge:组装 useProposalController + ProposalOverlay + ProposalToolbar
// ────────────────────────────────────────────────────────────────────────────

/**
 * applyHunkToEditor —— 应用单个 accepted hunk 到 Plate editor。
 *
 * - replace:先 removeNodes 再 insertNodes(倒序应用由 controller 保证)
 * - insert:在 blockPath 处插入 newBlocks
 * - delete:删除 blockPath 处的块
 *
 * 传入的 editor 类型用 unknown + 内部断言,避免引入 Plate 内部 SlateEditor 类型导致的
 * 循环依赖或版本耦合。生产调用者已保证 editor 是合法的 Plate editor 实例。
 */
function applyHunkToEditor(editor: unknown, hunk: Hunk) {
  const ed = editor as never as {
    tf: {
      removeNodes: (opts: { at: number[] }) => void;
      insertNodes: (nodes: unknown[], opts: { at: number[] }) => void;
    };
  };
  if (!hunk.blockPath) return;
  const at = hunk.blockPath as number[];
  try {
    if (hunk.kind === 'delete') {
      ed.tf.removeNodes({ at });
    } else if (hunk.kind === 'insert') {
      if (hunk.newBlocks) ed.tf.insertNodes(hunk.newBlocks, { at });
    } else if (hunk.kind === 'replace') {
      ed.tf.removeNodes({ at });
      if (hunk.newBlocks) ed.tf.insertNodes(hunk.newBlocks, { at });
    }
    if (import.meta.env.DEV) {
      console.debug(`[proposal-apply] ${hunk.kind} at=${JSON.stringify(at)}`);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error('[proposal-apply] 失败', err, hunk);
  }
}

interface ProposalBridgeProps {
  pending?: Proposal;
  onResolved?: (cleanMarkdown: string) => void;
  onHasPendingChange?: (hasPending: boolean) => void;
}

/**
 * ProposalBridge —— 在 <Plate> context 内组装 v3 三件套:
 * useProposalController(状态机) + ProposalOverlay(就地渲染) + ProposalToolbar(顶部条)。
 *
 * 与 v2 的 ProposalReviewBridge **并存**,Task 10 才删 v2 路径。父级 PlateEditor 选用哪条
 * 由 props 决定:传 v3Proposal 走 v3,传 pending/activeProposal 走 v2。
 *
 * 要求:调用方在 editor DOM 容器上设 `position: relative`
 * (EditorContainer 默认有 relative,ProposalOverlay 才能绝对定位正确)。
 */
function ProposalBridge({ pending, onResolved, onHasPendingChange }: ProposalBridgeProps) {
  const editor = useEditorRef();
  const controller = useProposalController(editor, {
    onApply: (h) => applyHunkToEditor(editor, h),
    onResolved,
    serializeMd: () => serializeMd(editor as never),
  });

  // 上抛 hasPending 给 PlateEditor,让上层把 <Plate readOnly> 同步锁定
  useEffect(() => {
    onHasPendingChange?.(controller.hasPending);
  }, [controller.hasPending, onHasPendingChange]);

  // 接收外部传入的 pending proposal:callId 变化时重新 setProposal
  useEffect(() => {
    if (pending && pending.callId !== controller.proposal?.callId) {
      controller.setProposal(pending);
    } else if (!pending && controller.proposal) {
      controller.setProposal(undefined);
    }
  // controller 对象引用在每次渲染都稳定(useMemo/useCallback),但此处仅依赖 pending 变化
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const pendingCount = controller.hunks.filter((h) => !controller.decisions.has(h.id)).length;

  return (
    <>
      <ProposalToolbar
        pendingCount={pendingCount}
        totalCount={controller.hunks.length}
        onAcceptAll={controller.acceptAll}
        onRejectAll={controller.rejectAll}
      />
      <ProposalOverlay
        hunks={controller.hunks}
        decisions={controller.decisions}
        onAcceptOne={controller.acceptOne}
        onRejectOne={controller.rejectOne}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// v2 ProposalReviewBridge(保留不动,Task 10 统一清理)
// ────────────────────────────────────────────────────────────────────────────

function ProposalReviewBridge({
  proposal,
  onAccept,
  onReject,
}: {
  proposal?: AiEditProposal;
  onAccept?: (proposal: AiEditProposal) => AiEditProposalOutcome;
  onReject?: (proposal: AiEditProposal) => void;
}) {
  const editor = useEditorRef();
  const [outcome, setOutcome] = useState<AiEditProposalOutcome | undefined>();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | undefined>();
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    setOutcome(undefined);
    setToolsOpen(false);
  }, [proposal?.id]);

  const getTargetRange = useCallback(() => {
    if (!proposal || proposal.targetKind !== 'reference') return undefined;

    const anchor = proposal.targetReference?.anchor;
    if (!anchor || anchor.type !== 'range') return undefined;
    const span = getAnchorBlockSpan(anchor, editor.children.length);
    if (!span) return undefined;
    const [startBlock, endBlock] = span;
    const api = editor.api as {
      start: (at: number[]) => AnchorRange['anchor'] | undefined;
      end: (at: number[]) => AnchorRange['focus'] | undefined;
      toDOMRange: (range: AnchorRange) => Range | undefined;
    };
    const start = api.start([startBlock]);
    const end = api.end([endBlock]);
    if (!start || !end) return undefined;
    return api.toDOMRange({ anchor: start, focus: end });
  }, [editor, proposal]);

  const updatePosition = useCallback(() => {
    if (!proposal) {
      setPosition(undefined);
      return;
    }

    const editorEl = document.querySelector<HTMLElement>(
      '.prose-draft-editor-surface [data-slate-editor]',
    );
    const editorRect = editorEl?.getBoundingClientRect();
    const domRange = getTargetRange();
    const rect = domRange?.getBoundingClientRect();

    const fallbackLeft = editorRect ? editorRect.left + 24 : 360;
    const fallbackWidth = editorRect ? Math.min(720, editorRect.width - 48) : 680;
    if (!rect || rect.width === 0 || rect.height === 0 || !editorRect) {
      setPosition({
        top: Math.max(72, editorRect ? editorRect.top + 24 : 96),
        left: fallbackLeft,
        width: Math.max(360, fallbackWidth),
      });
      return;
    }

    const width = Math.min(
      Math.max(rect.width + 32, 440),
      Math.max(360, editorRect.width - 48),
      760,
    );
    const minLeft = editorRect.left + 24;
    const maxLeft = editorRect.right - width - 24;
    const preferredLeft = rect.left - 16;
    setPosition({
      top: Math.max(60, rect.top - 10),
      left: Math.max(minLeft, Math.min(preferredLeft, maxLeft)),
      width,
    });
  }, [getTargetRange, proposal]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    if (!proposal) return undefined;
    const domRange = getTargetRange();
    domRange?.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });

    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [getTargetRange, proposal, updatePosition]);

  useEffect(() => {
    if (!proposal || !('highlights' in CSS)) return undefined;
    CSS.highlights.delete('ai-edit-proposal-target');
    const domRange = getTargetRange();
    if (domRange) {
      CSS.highlights.set('ai-edit-proposal-target', new Highlight(domRange));
    }

    return () => {
      CSS.highlights.delete('ai-edit-proposal-target');
    };
  }, [getTargetRange, proposal]);

  useEffect(() => {
    if (!proposal) return undefined;
    const handleUpdate = () => updatePosition();
    window.addEventListener('resize', handleUpdate);
    document.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      document.removeEventListener('scroll', handleUpdate, true);
    };
  }, [proposal, updatePosition]);

  if (!proposal) return null;

  const failed = outcome && !outcome.ok;

  return (
    <div
      className="pointer-events-none fixed z-30"
      style={{
        top: position?.top ?? 96,
        left: position?.left ?? 360,
        width: position?.width ?? 680,
      }}
    >
      <div
        className="group/proposal relative pointer-events-auto rounded-md shadow-sm"
        style={{
          background: 'var(--paper)',
          border: `1px solid ${failed ? 'var(--mark-red)' : 'color-mix(in srgb, var(--accent) 38%, var(--separator))'}`,
          color: 'var(--ink)',
          fontFamily: 'var(--font-reading)',
        }}
        onMouseEnter={() => setToolsOpen(true)}
        onMouseLeave={() => setToolsOpen(false)}
      >
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs" style={{ color: failed ? 'var(--mark-red)' : 'var(--ink-faded)' }}>
          {failed ? (
            <AlertTriangle size={13} strokeWidth={2} />
          ) : (
            <PencilLine size={13} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          )}
          <span>{failed ? failureText(outcome.reason) : formatProposalTarget(proposal)}</span>
        </div>

        <InlineProposalPatch oldText={proposal.oldText} newText={proposal.newText} />

        <button
          type="button"
          className="absolute -right-12 top-2 flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-opacity"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            opacity: toolsOpen ? 1 : 0.72,
          }}
          aria-label="审查建议"
          title="审查建议"
          onClick={() => setToolsOpen((open) => !open)}
        >
          <PencilLine size={16} strokeWidth={1.8} />
        </button>

        <div
          className="absolute left-[calc(100%+14px)] top-0 w-64 rounded-lg px-3 py-2 text-xs shadow-sm transition-opacity"
          style={{
            background: 'color-mix(in srgb, var(--paper) 96%, var(--shelf))',
            border: '1px solid var(--separator)',
            color: 'var(--ink-faded)',
            opacity: toolsOpen || failed ? 1 : 0,
            pointerEvents: toolsOpen || failed ? 'auto' : 'none',
          }}
        >
          <div className="font-medium" style={{ color: 'var(--ink)' }}>
            {proposal.title || '建议修改'}
          </div>
          {proposal.reason && (
            <div className="mt-1 line-clamp-4 leading-relaxed">
              {proposal.reason}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOutcome(undefined);
                onReject?.(proposal);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              <X size={13} strokeWidth={2} />
              拒绝
            </button>
            <button
              type="button"
              onClick={() => {
                const result = onAccept?.(proposal) ?? { ok: false, reason: 'not-found' as const };
                if (!result.ok) setOutcome(result);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
            >
              <Check size={13} strokeWidth={2} />
              接受
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineProposalPatch({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  return (
    <div className="max-h-[38vh] overflow-y-auto text-base leading-relaxed">
      <div
        className="grid grid-cols-[2rem_1fr] border-t"
        style={{ borderColor: 'var(--separator)' }}
      >
        <div
          className="select-none px-2 py-2 text-right font-mono text-sm"
          style={{
            color: 'var(--mark-red)',
            background: 'color-mix(in srgb, var(--mark-red) 7%, transparent)',
          }}
        >
          -
        </div>
        <div
          className="whitespace-pre-wrap px-3 py-2"
          style={{
            color: 'color-mix(in srgb, var(--ink) 72%, var(--mark-red))',
            background: 'color-mix(in srgb, var(--mark-red) 6%, var(--paper))',
          }}
        >
          <span className="line-through decoration-[var(--mark-red)] decoration-1">
            {oldText}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[2rem_1fr]">
        <div
          className="select-none px-2 py-2 text-right font-mono text-sm"
          style={{
            color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 9%, transparent)',
          }}
        >
          +
        </div>
        <div
          className="whitespace-pre-wrap px-3 py-2"
          style={{
            color: 'var(--ink)',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--paper))',
          }}
        >
          {newText}
        </div>
      </div>
    </div>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toEditorAssetUrls(markdown: string, contentItemId: string): string {
  return markdown.replaceAll(
    './assets/',
    `/api/v1/spaces/notes/items/${contentItemId}/assets/`,
  );
}

function toStoredAssetPaths(markdown: string, contentItemId: string): string {
  const id = escapeRegExp(contentItemId);
  const assetUrlPattern = new RegExp(
    `(?:https?://[^/]+)?/api/v1/spaces/notes/items/${id}/assets/([^?\\)\\s"]+)(?:\\?[^)\\s"]*)?`,
    'g',
  );

  return markdown.replace(assetUrlPattern, (_match, fileName: string) => {
    return `./assets/${fileName}`;
  });
}

function getAnchorBlockSpan(
  anchor: Extract<AnchorPayload, { type: 'range' }>,
  blockCount: number,
) {
  const start = anchor.startPath[0] ?? anchor.blockIndex ?? 0;
  const end = anchor.endPath[0] ?? anchor.blockIndex ?? start;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < 0 ||
    blockCount <= 0
  ) {
    return undefined;
  }
  const from = Math.min(start, end);
  const to = Math.min(Math.max(start, end), blockCount - 1);
  if (from >= blockCount || to < from) return undefined;
  return [from, to] as const;
}

function isSameProposalText(currentText: string, oldText: string): boolean {
  const current = normalizeForProposalMatch(currentText);
  const old = normalizeForProposalMatch(oldText);
  return Boolean(current && old && current === old);
}

function normalizeForProposalMatch(text: string): string {
  return normalizeProposalText(text).replace(/\s+/g, '');
}

function formatProposalTarget(proposal: AiEditProposal): string {
  if (proposal.targetKind === 'document') return '审查范围：整篇文稿';
  const anchor = proposal.targetReference?.anchor;
  if (!anchor || anchor.type !== 'range') return '审查范围：引用片段';
  const start = anchor.startPath?.[0] ?? anchor.blockIndex;
  const end = anchor.endPath?.[0] ?? start;
  const from = Math.min(start, end) + 1;
  const to = Math.max(start, end) + 1;
  return from === to ? `审查范围：第 ${from} 段` : `审查范围：第 ${from}-${to} 段`;
}

export function PlateMarkdownEditor({
  initialMarkdown,
  onChange,
  onResolved,
  onAnchorChange,
  onAddSelectionToChat,
  pending,
  onOutcomesByCallIdChange,
  onApplyProposalReady,
  activeProposal,
  onAcceptProposal,
  onRejectProposal,
  v3Proposal,
  onV3Resolved,
  onHasV3PendingChange,
}: {
  initialMarkdown: string;
  /**
   * @param markdown 序列化后的正文
   * @param isUserEdit 是否为用户真实编辑。加载内容时 Slate 规范化 / markdown 往返也会
   *   触发 onValueChange,但那时编辑器【没有焦点】——据此区分,避免把"打开页面"误判为
   *   编辑、触发无谓自动保存(把保存时间戳跳到打开时刻)。
   */
  onChange: (markdown: string, isUserEdit: boolean) => void;
  /** @deprecated 固定工具栏已移除，保留参数兼容文集编辑器 */
  toolbarContainer?: HTMLElement | null;
  /** v2 改稿:裁决完毕→干净正文回流(供上游 setBody(md,true) 强制标脏触发保存) */
  onResolved?: (cleanMarkdown: string) => void;
  /**
   * 当前编辑器 selection 变化回调（v2 改稿锚点）。
   * AnchorBridge 在 <Plate> 内订阅 selection，序列化后经此回调上报给父层（ProseDraftEditor）。
   */
  onAnchorChange?: (anchor: AnchorPayload) => void;
  /** 浮动工具栏「添加到聊天」:显式把当前 live range 作为聊天附件传给左侧 Aurora */
  onAddSelectionToChat?: (attachment: ChatSelectionAttachment) => void;
  /**
   * v2 改稿:最近一次落稳的工具调用(单个),由 useAdvisorChat 监听三工具产出,
   * 经 AiAdvisorPanel → ProseDraftEditor → 此处透传给 AiEditBridge,
   * 在 <Plate> 内调 applyAiEdit 落 suggestion。callId 作前端去重 key + outcomes 索引键。
   */
  pending?: PendingAiEdit;
  /**
   * v2 改稿 outcomes(按 callId 索引)上报回调。AiEditBridge 落地后产出 outcome,
   * 经此上抛到 ProseDraftEditor;Task 7 卡片渲染时按 toolCallId 查对应 outcome 标红失败项。
   */
  onOutcomesByCallIdChange?: (m: Record<string, AiEditOutcome>) => void;
  /** 注册 proposal 接受处理器：接受时在 Plate 内按冻结 range 替换节点。 */
  onApplyProposalReady?: (
    handler: (proposal: AiEditProposal) => AiEditProposalOutcome,
  ) => void;
  /** 当前在中间编辑区审查的模型修改提案；仅作 overlay，不写入正文。 */
  activeProposal?: AiEditProposal;
  onAcceptProposal?: (proposal: AiEditProposal) => AiEditProposalOutcome;
  onRejectProposal?: (proposal: AiEditProposal) => void;
  /** v3 改稿:聊天侧上抛的待审批 proposal(含 newMarkdown + reason + hunks) */
  v3Proposal?: Proposal;
  /** v3 改稿:所有 hunks 裁决完后干净 markdown 的回调 */
  onV3Resolved?: (cleanMarkdown: string) => void;
  /** v3 改稿:有 pending hunks 时上报(让上层切编辑器 readOnly) */
  onHasV3PendingChange?: (hasPending: boolean) => void;
}) {
  const { contentItemId } = useDraftAssetContext();
  const [editorId] = useState(() => `plate-${Math.random().toString(36).slice(2)}`);
  // 审阅锁定态(v2):由 AiEditBridge 上报。有未决 suggestion → readOnly。
  const [hasPending, setHasPending] = useState(false);
  // 审阅锁定态(v3):由 ProposalBridge 上报。有未裁决 hunk → readOnly。
  const [hasV3Pending, setHasV3Pending] = useState(false);
  const [toolbarSuppressed, setToolbarSuppressed] = useState(false);
  const toolbarSuppressTimerRef = useRef<number | null>(null);
  const editorMarkdown = useMemo(
    () => toEditorAssetUrls(initialMarkdown || '', contentItemId),
    [contentItemId, initialMarkdown],
  );

  const editor = usePlateEditor(
    {
      id: editorId,
      plugins: EditorKit,
      value: (editor) => {
        try {
          const nodes = deserializeMd(editor, editorMarkdown);
          return fixCodeBlockLines(nodes);
        } catch (err) {
          console.error('[PlateEditor] Markdown 反序列化失败:', err);
          // 反序列化失败时降级为空段落
          return [{ type: 'p', children: [{ text: '' }] }];
        }
      },
    },
    [],
  );

  const handleChange = useCallback(() => {
    if (!editor) return;
    // 有未决 suggestion → 不同步进 bodyMarkdown(防旧+新叠加序列化成 <suggestion> 垃圾污染草稿)。
    // 裁决完毕后由 controller 主动 serializeMd 干净正文回流(onResolved),不走这条 onChange。
    // api.nodes({at:[]}) 返回数组,非空即还有未决。
    if (editor.getApi(SuggestionPlugin).suggestion.nodes({ at: [] }).length > 0) return;
    // 过滤掉上传中的 placeholder 节点再序列化，避免脏 HTML 污染 markdown
    const hasPlaceholder = editor.children.some(
      (node) => 'type' in node && (node as { type: string }).type === 'placeholder',
    );
    if (hasPlaceholder) return; // 上传中，跳过本次序列化
    try {
      const md = toStoredAssetPaths(serializeMd(editor), contentItemId);
      // 编辑器有焦点 = 用户在打字/用工具栏 → 真实编辑;无焦点 = 加载时的规范化/往返 → 非编辑。
      // data-slate-editor 是 Slate 标准属性,判断与 Plate 版本无关。
      const isUserEdit =
        typeof document !== 'undefined' &&
        !!document.activeElement?.closest('[data-slate-editor="true"]');
      onChange(md, isUserEdit);
    } catch {
      /* Serialize can fail during rapid edits — skip, next change will catch up */
    }
  }, [contentItemId, editor, onChange]);

  const handleAnchorChange = useCallback(
    (anchor: AnchorPayload) => {
      // 添加到聊天后会清掉原生 selection,但 Plate floating toolbar 可能保留上一帧位置。
      // 下一次用户真的拖出 range 时再恢复 toolbar。
      if (anchor.type === 'range') setToolbarSuppressed(false);
      onAnchorChange?.(anchor);
    },
    [onAnchorChange],
  );

  const handleAddSelectionToChat = useCallback(
    (text: string) => {
      const attachment = createLiveChatSelectionAttachment({
        editor: {
          children: editor.children as LiveSelectionEditor['children'],
          selection: editor.selection as LiveSelectionEditor['selection'],
          api: {
            after: editor.api.after as LiveSelectionEditor['api']['after'],
            end: editor.api.end as LiveSelectionEditor['api']['end'],
            rangeRef: editor.api.rangeRef as LiveSelectionEditor['api']['rangeRef'],
            start: editor.api.start as LiveSelectionEditor['api']['start'],
            string: editor.api.string as LiveSelectionEditor['api']['string'],
            toDOMRange: editor.api.toDOMRange as LiveSelectionEditor['api']['toDOMRange'],
          },
        },
        preview: text,
      });
      if (!attachment) return;
      setToolbarSuppressed(true);
      if (toolbarSuppressTimerRef.current !== null) {
        window.clearTimeout(toolbarSuppressTimerRef.current);
      }
      editor.tf.deselect();
      toolbarSuppressTimerRef.current = window.setTimeout(() => {
        toolbarSuppressTimerRef.current = null;
        setToolbarSuppressed(false);
      }, 120);
      onAddSelectionToChat?.(attachment);
    },
    [editor, onAddSelectionToChat],
  );

  useEffect(() => {
    return () => {
      if (toolbarSuppressTimerRef.current !== null) {
        window.clearTimeout(toolbarSuppressTimerRef.current);
        toolbarSuppressTimerRef.current = null;
      }
    };
  }, []);

  const applyProposal = useCallback(
    (proposal: AiEditProposal): AiEditProposalOutcome => {
      if (proposal.targetKind === 'document') {
        const currentMarkdown = toStoredAssetPaths(serializeMd(editor), contentItemId);
        if (!isSameProposalText(currentMarkdown, proposal.oldText)) {
          return { ok: false, reason: 'not-found' };
        }
        try {
          const newDoc = deserializeMd(editor, proposal.newText);
          if (!Array.isArray(newDoc) || newDoc.length === 0) {
            return { ok: false, reason: 'empty' };
          }
          editor.tf.setValue(newDoc);
          const md = toStoredAssetPaths(serializeMd(editor), contentItemId);
          onResolved?.(md);
          return { ok: true };
        } catch {
          return { ok: false, reason: 'parse-error' };
        }
      }

      const anchor = proposal.targetReference?.anchor;
      if (!anchor || anchor.type !== 'range') return { ok: false, reason: 'no-anchor' };
      const span = getAnchorBlockSpan(anchor, editor.children.length);
      if (!span) return { ok: false, reason: 'no-anchor' };

      const [startBlock, endBlock] = span;
      const oldBlocks = editor.children.slice(startBlock, endBlock + 1);
      const currentText = oldBlocks.map((block) => NodeApi.string(block)).join('\n\n');
      if (!isSameProposalText(currentText, proposal.oldText)) {
        return { ok: false, reason: 'not-found' };
      }

      let newBlocks;
      try {
        newBlocks = deserializeMd(editor, proposal.newText);
      } catch {
        return { ok: false, reason: 'parse-error' };
      }
      if (!Array.isArray(newBlocks) || newBlocks.length === 0) {
        return { ok: false, reason: 'empty' };
      }

      try {
        editor.tf.withoutNormalizing(() => {
          for (let index = endBlock; index >= startBlock; index -= 1) {
            editor.tf.removeNodes({ at: [index] });
          }
          editor.tf.insertNodes(newBlocks, { at: [startBlock] });
        });
        const md = toStoredAssetPaths(serializeMd(editor), contentItemId);
        onResolved?.(md);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'parse-error' };
      }
    },
    [contentItemId, editor, onResolved],
  );

  useEffect(() => {
    onApplyProposalReady?.(applyProposal);
  }, [applyProposal, onApplyProposalReady]);

  if (!editor) return null;

  return (
    <TooltipProvider>
      {/* readOnly 设在 <Plate>(store-level 只读):
          - v2:有未决 suggestion(hasPending)或 proposal overlay(activeProposal)时锁定
          - v3:有未裁决 hunk(hasV3Pending)时锁定
          防止审查期间正文继续变化导致接受时定位漂移。 */}
      <Plate
        key={editorId}
        editor={editor}
        onValueChange={handleChange}
        readOnly={hasPending || Boolean(activeProposal) || hasV3Pending}
      >
        {/* AiEditBridge —— v2 改稿总控:applyAiEdit 落 suggestion + 顶部审阅操作条。
            和 AnchorBridge 平行,各自订阅 selection(职责解耦,见 AiEditBridge 注释)。 */}
        <AiEditBridge
          pending={pending}
          onResolved={onResolved}
          onHasPendingChange={setHasPending}
          onOutcomesByCallIdChange={onOutcomesByCallIdChange}
        />
        {/* AnchorBridge 订阅 selection 并上报 AnchorPayload，供 v2 改稿锚点注入(transport 用) */}
        {onAnchorChange && (
          <AnchorBridge onAnchorChange={handleAnchorChange} />
        )}
        {/* v2 ProposalReviewBridge —— 保留不动,Task 10 才删 */}
        <ProposalReviewBridge
          proposal={activeProposal}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
        />
        {/* v3 ProposalBridge —— 仅当 v3Proposal 存在时渲染,与 v2 路径并存互不干扰 */}
        <ProposalBridge
          pending={v3Proposal}
          onResolved={onV3Resolved}
          onHasPendingChange={(hasPending) => {
            setHasV3Pending(hasPending);
            onHasV3PendingChange?.(hasPending);
          }}
        />
        <EditorContainer
          className="prose-draft-editor-surface"
          onPointerDownCapture={() => setToolbarSuppressed(false)}
        >
          <Editor variant="default" placeholder="开始写作..." />
        </EditorContainer>
        {!toolbarSuppressed && (
          <FloatingToolbar>
            <FloatingToolbarButtons
              onAddSelectionToChat={handleAddSelectionToChat}
            />
          </FloatingToolbar>
        )}
      </Plate>
    </TooltipProvider>
  );
}
