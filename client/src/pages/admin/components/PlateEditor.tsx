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

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  serializeAnchor,
  createLiveChatSelectionAttachment,
  type AnchorPayload,
  type ChatSelectionAttachment,
  type LiveSelectionEditor,
} from '@/pages/admin/lib/live-chat-selection';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import type { Descendant } from 'platejs';
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

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
import { EditorKit } from '@/components/editor/editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { FloatingToolbarButtons } from '@/components/ui/floating-toolbar-buttons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDraftAssetContext } from '@/contexts/DraftAssetContext';

/**
 * EditorChildrenBridge — 在 <Plate> context 内把 editor 实例 + children 写进父级传入的 ref。
 *
 * 为什么需要单独子组件：useEditorRef 必须在 <Plate> context 内调用，但调用方(AiAdvisorPanel/
 * use-advisor-chat)在 <Plate> 外——通过此桥把 editor 暴露出去，聊天侧 computeDocDiff /
 * deserializeMd 才能拿到真实 editor.children + editor 实例。
 *
 * 调用方通过 PlateMarkdownEditor.editorRefSync prop 传入 ref，组件 unmount 时自动置 null
 * 防悬空引用。
 */
export interface EditorBridgeHandle {
  getChildren: () => Descendant[];
  getEditor: () => unknown;
}

function EditorChildrenBridge({
  bridgeRef,
}: {
  bridgeRef: React.MutableRefObject<EditorBridgeHandle | null>;
}) {
  const editor = useEditorRef();
  useEffect(() => {
    bridgeRef.current = {
      getChildren: () => editor.children as Descendant[],
      getEditor: () => editor,
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [editor, bridgeRef]);
  return null;
}

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

// ────────────────────────────────────────────────────────────────────────────
// v3 ProposalBridge:组装 useProposalController + ProposalOverlay + ProposalToolbar
// ────────────────────────────────────────────────────────────────────────────


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
    onResolved,
    serializeMd: () => serializeMd(editor as never),
  });

  // ref 模式跟踪 onHasPendingChange,避免父级传内联箭头函数时引用变化触发 effect 死循环
  // (上层 PlateEditor JSX 里若用 `onHasPendingChange={(b)=>{...}}` 每次 render 新建 fn → 旧实现会无限 re-run)
  const onHasPendingChangeRef = useRef(onHasPendingChange);
  useEffect(() => {
    onHasPendingChangeRef.current = onHasPendingChange;
  });

  // 上抛 hasPending 给 PlateEditor,让上层把 <Plate readOnly> 同步锁定
  // 只依赖 boolean 值变化,与 callback 引用解耦
  useEffect(() => {
    onHasPendingChangeRef.current?.(controller.hasPending);
  }, [controller.hasPending]);

  // 接收外部传入的 pending proposal:callId 变化时重新 setProposal
  useEffect(() => {
    if (pending && pending.callId !== controller.proposal?.callId) {
      controller.setProposal(pending);
    } else if (!pending && controller.proposal) {
      controller.setProposal(undefined);
    }
  // controller 对象引用在每次渲染都新建,但此处仅依赖 pending 变化(callId 字符串比较)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const pendingCount = controller.hunks.filter((h) => !controller.decisions.has(h.id)).length;

  // 延迟挂载 ProposalOverlay 一帧:
  // setHasV3Pending 是父级 state,onHasPendingChange 触发后 readOnly=true 切换 + Plate 内部
  // 把真编辑器 contenteditable 改为 false 是 React 异步过程。如果 ProposalOverlay 与 controller
  // 同步挂载,首次 useMemo/useEffect 跑 DOM 查询时 contenteditable 还是 "true",selector
  // `[data-slate-editor][contenteditable="false"]` 失败 → overlays 空。
  // 用 rAF 推到下一帧,DOM 更新一定完成。
  const [overlayReady, setOverlayReady] = useState(false);
  useEffect(() => {
    if (controller.hasPending) {
      const raf = requestAnimationFrame(() => setOverlayReady(true));
      return () => {
        cancelAnimationFrame(raf);
        setOverlayReady(false);
      };
    }
    setOverlayReady(false);
    return undefined;
  }, [controller.hasPending]);

  return (
    <>
      <ProposalToolbar
        pendingCount={pendingCount}
        totalCount={controller.hunks.length}
        onAcceptAll={controller.acceptAll}
        onRejectAll={controller.rejectAll}
      />
      {overlayReady && (
        <ProposalOverlay
          hunks={controller.hunks}
          decisions={controller.decisions}
          onAcceptOne={controller.acceptOne}
          onRejectOne={controller.rejectOne}
        />
      )}
    </>
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

export function PlateMarkdownEditor({
  initialMarkdown,
  onChange,
  onAnchorChange,
  onAddSelectionToChat,
  v3Proposal,
  onV3Resolved,
  onHasV3PendingChange,
  editorRefSync,
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
  /**
   * 当前编辑器 selection 变化回调。
   * AnchorBridge 在 <Plate> 内订阅 selection，序列化后经此回调上报给父层（ProseDraftEditor）。
   */
  onAnchorChange?: (anchor: AnchorPayload) => void;
  /** 浮动工具栏「添加到聊天」:显式把当前 live range 作为聊天附件传给左侧 Aurora */
  onAddSelectionToChat?: (attachment: ChatSelectionAttachment) => void;
  /** v3 改稿:聊天侧上抛的待审批 proposal(含 newMarkdown + reason + hunks) */
  v3Proposal?: Proposal;
  /** v3 改稿:所有 hunks 裁决完后干净 markdown 的回调 */
  onV3Resolved?: (cleanMarkdown: string) => void;
  /** v3 改稿:有 pending hunks 时上报(让上层切编辑器 readOnly) */
  onHasV3PendingChange?: (hasPending: boolean) => void;
  /**
   * v3 改稿：外层通过此 ref 拿到 editor.children + editor 实例。
   * EditorChildrenBridge 在 <Plate> context 内填充；聊天侧 computeDocDiff / deserializeMd 读取。
   */
  editorRefSync?: MutableRefObject<EditorBridgeHandle | null>;
}) {
  const { contentItemId } = useDraftAssetContext();
  const [editorId] = useState(() => `plate-${Math.random().toString(36).slice(2)}`);
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

  if (!editor) return null;

  return (
    <TooltipProvider>
      {/* readOnly：v3 有未裁决 hunk 时锁定，防止审查期间正文变化导致位置漂移 */}
      <Plate
        key={editorId}
        editor={editor}
        onValueChange={handleChange}
        readOnly={hasV3Pending}
      >
        {/* AnchorBridge 订阅 selection 并上报 AnchorPayload */}
        {onAnchorChange && (
          <AnchorBridge onAnchorChange={handleAnchorChange} />
        )}
        {/* v3 EditorChildrenBridge —— 传了 editorRefSync 才挂,把 editor.children/editor
            写进 ref,外层 getEditorChildren/getEditor 给 use-advisor-chat 算 computeDocDiff 用 */}
        {editorRefSync && <EditorChildrenBridge bridgeRef={editorRefSync} />}
        <EditorContainer
          className="prose-draft-editor-surface"
          style={{ position: 'relative' }}
          onPointerDownCapture={() => setToolbarSuppressed(false)}
        >
          <Editor variant="default" placeholder="开始写作..." />
          {/* v3 ProposalBridge 必须放在 EditorContainer 内部:
              ProposalOverlay 输出的 absolute div 需要 EditorContainer(position:relative)
              作为定位上下文,top/left 才会相对 editor 内容区算出正确位置;
              如果挂在 Plate 外层,absolute 会相对 viewport/body → 浮层飘到屏幕左上角。 */}
          <ProposalBridge
            pending={v3Proposal}
            onResolved={onV3Resolved}
            onHasPendingChange={(hasPending) => {
              setHasV3Pending(hasPending);
              onHasV3PendingChange?.(hasPending);
            }}
          />
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
