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
import { useProposedEditController } from '@/pages/admin/lib/use-proposed-edit-controller';
import type { EditOutcome, ProposedEdit } from '@/pages/admin/lib/apply-proposed-edits';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import {
  Plate,
  usePlateEditor,
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
 * ProposedEditBridge — 在 <Plate> context 内部把外部传来的 edits 落成 suggestion 痕迹,
 * 并提供"审阅锁定 + 全部接受/拒绝"操作条。
 *
 * 为什么需要单独一个子组件:useProposedEditController 内部调用 useEditorRef(),
 * 而 useEditorRef 必须在 <Plate> 的 context 内才能取到 editor 实例。
 * PlateMarkdownEditor 的父级(ProseDraftEditor)在 <Plate> 外面,因此不能在父级调用 controller。
 * 把 bridge 渲染在 <Plate> 内部(与 EditorContainer 同级)即可满足该约束。
 *
 * controller 产出的 hasPending / outcomes 通过回调上报给 PlateMarkdownEditor 层:
 * - hasPending → 驱动 <Plate readOnly>(只读机制设在 Plate store,统一阻止所有编辑)
 * - outcomes(+editsKey)→ 透传到聊天卡片,失败项标红回流
 */
function ProposedEditBridge({
  pendingEdits,
  editsKey,
  onResolved,
  onHasPendingChange,
  onOutcomes,
}: {
  pendingEdits?: ProposedEdit[];
  editsKey?: string;
  /** 裁决完毕(节点树干净)→ 干净正文回流,供上游触发保存 */
  onResolved?: (cleanMarkdown: string) => void;
  /** 审阅锁定态变化上报,PlateMarkdownEditor 据此给 <Plate> 设 readOnly */
  onHasPendingChange?: (hasPending: boolean) => void;
  /** 应用结果上报(供聊天卡片标红失败项) */
  onOutcomes?: (outcomes: EditOutcome[], key: string) => void;
}) {
  const { outcomes, hasPending, acceptAll, rejectAll } = useProposedEditController(
    pendingEdits,
    editsKey ?? '',
    onResolved,
  );

  // hasPending 变化上报给 PlateMarkdownEditor → 驱动 <Plate readOnly>
  useEffect(() => {
    onHasPendingChange?.(hasPending);
  }, [hasPending, onHasPendingChange]);

  // outcomes 落定后上报(供聊天卡片标红);editsKey 关联到对应的 propose_edit part
  useEffect(() => {
    if (outcomes.length > 0) onOutcomes?.(outcomes, editsKey ?? '');
  }, [outcomes, editsKey, onOutcomes]);

  // 无未决 suggestion → 不渲染操作条
  if (!hasPending) return null;

  // 顶部审阅操作条:贴在编辑器顶部,提示有待裁决的修改 + 全部接受/拒绝按钮。
  // 视觉沿用项目变量(accent 主色 / ink 文字 / paper 底),与设计系统一致。
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
  pendingEdits,
  editsKey,
  onResolved,
  onOutcomes,
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
  /** Aurora 改稿建议:来自 AiAdvisorPanel → ProseDraftEditor 透传,在 <Plate> 内部应用为 suggestion 痕迹 */
  pendingEdits?: ProposedEdit[];
  /** 与 pendingEdits 配套的去重 key(toolCallId),保证同一批 edits 只落一次 suggestion */
  editsKey?: string;
  /** 裁决完毕→干净正文回流(供上游 setBody(md,true) 强制标脏触发保存) */
  onResolved?: (cleanMarkdown: string) => void;
  /** 应用结果上报(供聊天卡片标红失败项),key 关联到 propose_edit part */
  onOutcomes?: (outcomes: EditOutcome[], key: string) => void;
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
        {/* ProposedEditBridge 必须在 <Plate> 内部,使用 useEditorRef 需要 Plate context */}
        <ProposedEditBridge
          pendingEdits={pendingEdits}
          editsKey={editsKey}
          onResolved={onResolved}
          onHasPendingChange={setHasPending}
          onOutcomes={onOutcomes}
        />
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
