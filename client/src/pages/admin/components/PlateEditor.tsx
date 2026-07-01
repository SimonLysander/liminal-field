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
import { useProposalKeyboardNav } from '@/pages/admin/lib/use-proposal-keyboard-nav';
// ProposalToolbar 不再由 ProposalBridge 渲染;现在由 ProseDraftEditor 在中间栏顶栏渲染
import { ProposalControlsContext } from '@/components/editor/proposal-controls-context';

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
 * 为什么需要单独子组件：useEditorRef 必须在 <Plate> context 内调用，但调用方(AdvisorSidebar/
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
// v3.1 ProposalBridge:Context Provider 模式 — 节点树自带渲染,弃 ProposalOverlay + rAF
// ────────────────────────────────────────────────────────────────────────────

/** 审批态时,中间栏顶栏需要的 UI state(由 ProseDraftEditor 接住后切换顶栏内容) */
export interface ProposalUiState {
  pendingCount: number;
  totalCount: number;
  /** 不传引用,父级用 ref 跟踪稳定调用 */
  acceptAll: () => void;
  rejectAll: () => void;
}

interface ProposalBridgeProps {
  pending?: Proposal;
  onResolved?: (cleanMarkdown: string) => void;
  onHasPendingChange?: (hasPending: boolean) => void;
  /** 审批态时上抛 UI state;退出审批时上抛 null 让父级恢复正常顶栏 */
  onProposalUiChange?: (state: ProposalUiState | null) => void;
  children: React.ReactNode;
}

/**
 * ProposalBridge —— v3.1 改稿桥:
 *
 * - controller 收 pending,内部展开节点树 + 提供 acceptOne/rejectOne
 * - 用 ProposalControlsContext.Provider 把回调透给 Plate element renderer 内的 ✓✗ 按钮
 * - 审批 toolbar 不再在这里渲染,而是通过 onProposalUiChange 上抛 state,
 *   由 ProseDraftEditor 在中间栏顶栏渲染(替换"标题/保存/提交"内容,零堆叠)
 *
 * 与 v3 ProposalBridge 的关键差异:
 * - 弃 ProposalOverlay + rAF + overlayReady(节点树自带渲染,element renderer 直接读 Context)
 * - 多了 children 参数(EditorContainer 等作为 Provider 子节点)
 */
function ProposalBridge({ pending, onResolved, onHasPendingChange, onProposalUiChange, children }: ProposalBridgeProps) {
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

  // 上抛审批 UI state 给 ProseDraftEditor —— 它在中间栏顶栏渲染审批控件
  // (替换"标题/保存"等正常顶栏内容,零堆叠)。
  // 用 ref 跟踪 callback + controller 引用,避免每次 render 把不稳定 fn 写进 state。
  const onProposalUiChangeRef = useRef(onProposalUiChange);
  useEffect(() => {
    onProposalUiChangeRef.current = onProposalUiChange;
  });
  // controller 每次 render 都新建,但其方法行为稳定 —— 用 ref 缓存最新引用,
  // 上抛给父级的 acceptAll/rejectAll 是稳定的代理(内部读 ref.current)。
  // ref 更新放进 effect(不在 render 期写 ref.current):代理只在按钮点击时读
  // ref.current,届时 effect 早已 commit,拿到的就是最新 controller。
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  });
  // 仅 hasPending / pendingCount / totalCount 变化时上抛,
  // controller fn 引用变化不触发(代理是稳定的,父级不必重渲染)
  const pendingCountForEffect = controller.hunks.filter(
    (h) => !controller.decisions.has(h.id),
  ).length;
  const totalCountForEffect = controller.hunks.length;
  useEffect(() => {
    if (!controller.hasPending) {
      onProposalUiChangeRef.current?.(null);
      return;
    }
    onProposalUiChangeRef.current?.({
      pendingCount: pendingCountForEffect,
      totalCount: totalCountForEffect,
      // 稳定代理:父级保存这个引用,实际调用时走 ref.current 拿当前 fn
      acceptAll: () => controllerRef.current.acceptAll(),
      rejectAll: () => controllerRef.current.rejectAll(),
    });
  }, [controller.hasPending, pendingCountForEffect, totalCountForEffect]);

  // 接收外部传入的 pending proposal:callId 变化时重新 setProposal(controller 内部展开节点树)
  useEffect(() => {
    if (pending && pending.callId !== controller.proposal?.callId) {
      controller.setProposal(pending);
    } else if (!pending && controller.proposal) {
      controller.setProposal(undefined);
    }
  // controller 对象引用在每次渲染都新建,但此处仅依赖 pending 变化(callId 字符串比较)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // 全局快捷键:↑↓ navigate + ⏎ 接受 + ⌫ 拒绝 —— 仅审批进行中挂载
  useProposalKeyboardNav({
    enabled: controller.hasPending,
    activeHunkId: controller.activeHunkId,
    acceptOne: controller.acceptOne,
    rejectOne: controller.rejectOne,
    navigateNext: controller.navigateNext,
    navigatePrev: controller.navigatePrev,
  });

  return (
    <ProposalControlsContext.Provider
      value={{
        acceptOne: controller.acceptOne,
        rejectOne: controller.rejectOne,
        activeHunkId: controller.activeHunkId,
        setActiveHunkId: controller.setActiveHunkId,
      }}
    >
      {/* 审批 toolbar 不再在这里渲染:state 通过 onProposalUiChange 上抛给
          ProseDraftEditor,由它在中间栏顶栏渲染(替换正常顶栏内容)*/}
      {children}
    </ProposalControlsContext.Provider>
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
  onChange = () => {},
  onAnchorChange,
  onAddSelectionToChat,
  v3Proposal,
  onV3Resolved,
  onHasV3PendingChange,
  onProposalUiChange,
  editorRefSync,
  readOnly: readOnlyProp,
}: {
  initialMarkdown: string;
  /**
   * @param markdown 序列化后的正文
   * @param isUserEdit 是否为用户真实编辑。加载内容时 Slate 规范化 / markdown 往返也会
   *   触发 onValueChange,但那时编辑器【没有焦点】——据此区分,避免把"打开页面"误判为
   *   编辑、触发无谓自动保存(把保存时间戳跳到打开时刻)。
   * 只读模式(readOnly=true)时可省略:此时编辑器不允许修改,onChange 不会被调用。
   */
  onChange?: (markdown: string, isUserEdit: boolean) => void;
  /**
   * 只读模式 —— 渲染文本但禁止编辑(如学习视图的 AI 初稿 / 规划预览栏)。
   * 设为 true 时同时隐藏浮动工具栏。
   */
  readOnly?: boolean;
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
  /** v3 改稿:审批态 UI state(上层在中间栏顶栏渲染审批控件) */
  onProposalUiChange?: (state: ProposalUiState | null) => void;
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
    // v3.1 改稿审批守卫:editor 含 proposal-old / proposal-new 临时节点时跳过同步。
    // 否则 serializeMd 看到这些 type 会输出 "Unreachable code" 警告,且把临时节点写进 bodyMarkdown
    // 污染 localStorage 草稿。审批完(controller.finalize)节点清干净后 controller 主动调
    // onResolved → setBody(md, true) 触发一次干净保存。
    const hasProposalNode = editor.children.some((node) => {
      const t = (node as { type?: string }).type;
      return t === 'proposal-old' || t === 'proposal-new';
    });
    if (hasProposalNode) return;
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
      // 引用到 Aurora 后会清掉原生 selection,但 Plate floating toolbar 可能保留上一帧位置。
      // 下一次用户真的拖出 range 时再恢复 toolbar。
      if (anchor.type === 'range') setToolbarSuppressed(false);
      onAnchorChange?.(anchor);
    },
    [onAnchorChange],
  );

  const handleAddSelectionToChat = useCallback(() => {
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
          fragment: editor.api.fragment as LiveSelectionEditor['api']['fragment'],
        },
      },
      preview: editor.selection ? editor.api.string(editor.selection) : '',
    });
    if (!attachment) return;
    setToolbarSuppressed(true);
    if (toolbarSuppressTimerRef.current !== null) {
      window.clearTimeout(toolbarSuppressTimerRef.current);
    }
    editor.tf.deselect();
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => window.getSelection()?.removeAllRanges(), 0);
    toolbarSuppressTimerRef.current = window.setTimeout(() => {
      toolbarSuppressTimerRef.current = null;
      setToolbarSuppressed(false);
    }, 120);
    onAddSelectionToChat?.(attachment);
  }, [editor, onAddSelectionToChat]);

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
      {/* readOnly：v3 有未裁决 hunk 时锁定,或调用方显式 readOnly(如学习视图 AI 初稿) */}
      <Plate
        key={editorId}
        editor={editor}
        onValueChange={handleChange}
        readOnly={hasV3Pending || !!readOnlyProp}
      >
        {/* AnchorBridge 订阅 selection 并上报 AnchorPayload */}
        {onAnchorChange && (
          <AnchorBridge onAnchorChange={handleAnchorChange} />
        )}
        {/* v3 EditorChildrenBridge —— 传了 editorRefSync 才挂,把 editor.children/editor
            写进 ref,外层 getEditorChildren/getEditor 给 use-advisor-chat 算 computeDocDiff 用 */}
        {editorRefSync && <EditorChildrenBridge bridgeRef={editorRefSync} />}
        {/* v3.1 ProposalBridge 包裹 EditorContainer:
            controller 展开节点树后,element renderer 通过 ProposalControlsContext 拿 acceptOne/rejectOne;
            弃用 ProposalOverlay(absolute overlay) + rAF 延迟,节点树自带就地渲染不需要定位上下文。 */}
        <ProposalBridge
          pending={v3Proposal}
          onResolved={onV3Resolved}
          onHasPendingChange={(hasPending) => {
            setHasV3Pending(hasPending);
            onHasV3PendingChange?.(hasPending);
          }}
          onProposalUiChange={onProposalUiChange}
        >
          <EditorContainer
            className="prose-draft-editor-surface"
            onPointerDownCapture={() => setToolbarSuppressed(false)}
          >
            <Editor variant="default" placeholder="开始写作..." />
          </EditorContainer>
        </ProposalBridge>
        {/* 只读模式不显示浮动工具栏(无编辑操作可执行);正常模式受 toolbarSuppressed 控制 */}
        {!readOnlyProp && !toolbarSuppressed && (
          <FloatingToolbar>
            <FloatingToolbarButtons
              onAddSelectionToChat={onAddSelectionToChat ? handleAddSelectionToChat : undefined}
            />
          </FloatingToolbar>
        )}
      </Plate>
    </TooltipProvider>
  );
}
