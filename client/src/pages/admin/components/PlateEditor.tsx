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

import { useCallback, useMemo, useState } from 'react';
import { useProposedEditController } from '@/pages/admin/lib/use-proposed-edit-controller';
import type { ProposedEdit } from '@/pages/admin/lib/apply-proposed-edits';
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
 * ProposedEditBridge — 在 <Plate> context 内部把外部传来的 edits 落成 suggestion 痕迹。
 *
 * 为什么需要单独一个子组件:useProposedEditController 内部调用 useEditorRef(),
 * 而 useEditorRef 必须在 <Plate> 的 context 内才能取到 editor 实例。
 * PlateMarkdownEditor 的父级(ProseDraftEditor)在 <Plate> 外面,因此不能在父级调用 controller。
 * 把 bridge 渲染在 <Plate> 内部(与 EditorContainer 同级)即可满足该约束。
 *
 * outcomes/acceptAll/rejectAll 预留给 Task 7/8 的 UI(聊天卡片 + 接受/拒绝按钮),
 * 本 task 只打通数据链,暂不向上暴露。
 */
function ProposedEditBridge({
  pendingEdits,
  editsKey,
}: {
  pendingEdits?: ProposedEdit[];
  editsKey?: string;
}) {
  useProposedEditController(pendingEdits, editsKey ?? '');
  return null;
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
}) {
  const { contentItemId } = useDraftAssetContext();
  const [editorId] = useState(() => `plate-${Math.random().toString(36).slice(2)}`);
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
      <Plate key={editorId} editor={editor} onValueChange={handleChange}>
        {/* ProposedEditBridge 必须在 <Plate> 内部,使用 useEditorRef 需要 Plate context */}
        <ProposedEditBridge pendingEdits={pendingEdits} editsKey={editsKey} />
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
