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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAiEditController, type PendingAiEdit } from '@/pages/admin/lib/use-ai-edit-controller';
import type { AiEditOutcome } from '@/pages/admin/lib/apply-ai-edit';
import { serializeAnchor, type AnchorPayload } from '@/pages/admin/lib/serialize-anchor';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  Plate,
  usePlateEditor,
  useEditorRef,
  useEditorSelector,
} from 'platejs/react';
import { serializeMd, deserializeMd } from '@platejs/markdown';

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

  const { outcomesByCallId, hasPending, acceptAll, rejectAll } = useAiEditController(
    pending,
    anchor,
    onResolved,
  );

  // hasPending 变化上报 → 父层驱动 <Plate readOnly>(同 v1 模式)
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
  onResolved,
  onAnchorChange,
  pending,
  onOutcomesByCallIdChange,
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
  /** 裁决完毕→干净正文回流(供上游 setBody(md,true) 强制标脏触发保存) */
  onResolved?: (cleanMarkdown: string) => void;
  /**
   * 当前编辑器 selection 变化回调（v2 改稿锚点）。
   * AnchorBridge 在 <Plate> 内订阅 selection，序列化后经此回调上报给父层（ProseDraftEditor）。
   */
  onAnchorChange?: (anchor: AnchorPayload) => void;
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
}) {
  const { contentItemId } = useDraftAssetContext();
  const [editorId] = useState(() => `plate-${Math.random().toString(36).slice(2)}`);
  // 审阅锁定态:由 <Plate> 内部 ProposedEditBridge 上报,据此给 <Plate> 设 readOnly。
  // 锁定时只读,用户只能通过操作条裁决,不能继续编辑(防 suggestion 与编辑交织污染)。
  const [hasPending, setHasPending] = useState(false);
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

  if (!editor) return null;

  return (
    <TooltipProvider>
      {/* readOnly 设在 <Plate>(store-level 只读):有未决 suggestion 时锁定整个编辑器,
          用户只能通过操作条全部接受/拒绝,裁决完毕自动解锁。比单独给 PlateContent 设更彻底。 */}
      <Plate key={editorId} editor={editor} onValueChange={handleChange} readOnly={hasPending}>
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
          <AnchorBridge onAnchorChange={onAnchorChange} />
        )}
        <EditorContainer>
          <Editor variant="default" placeholder="开始写作..." />
        </EditorContainer>
        <FloatingToolbar>
          <FloatingToolbarButtons />
        </FloatingToolbar>
      </Plate>
    </TooltipProvider>
  );
}
