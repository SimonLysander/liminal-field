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

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plate,
  usePlateEditor,
} from 'platejs/react';
import { serializeMd, deserializeMd } from '@platejs/markdown';

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
import { EditorKit } from '@/components/editor/editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FixedToolbar } from '@/components/ui/fixed-toolbar';
import { FixedToolbarButtons } from '@/components/ui/fixed-toolbar-buttons';
import { TooltipProvider } from '@/components/ui/tooltip';

export function PlateMarkdownEditor({
  initialMarkdown,
  onChange,
  toolbarContainer,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  toolbarContainer?: HTMLElement | null;
}) {
  const [editorId] = useState(() => `plate-${Math.random().toString(36).slice(2)}`);

  const editor = usePlateEditor(
    {
      id: editorId,
      plugins: EditorKit,
      value: (editor) => {
        try {
          const nodes = deserializeMd(editor, initialMarkdown || '');
          return fixCodeBlockLines(nodes);
        } catch (err) {
          // 反序列化失败时降级为空段落，记录错误供调试
          console.error('[PlateEditor] Markdown 反序列化失败:', err);
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
      const md = serializeMd(editor);
      onChange(md);
    } catch {
      /* Serialize can fail during rapid edits — skip, next change will catch up */
    }
  }, [editor, onChange]);

  if (!editor) return null;

  return (
    <TooltipProvider>
      <Plate key={editorId} editor={editor} onValueChange={handleChange}>
        {toolbarContainer && createPortal(
          <FixedToolbar>
            <FixedToolbarButtons />
          </FixedToolbar>,
          toolbarContainer,
        )}
        <EditorContainer>
          <Editor variant="default" placeholder="开始写作..." />
        </EditorContainer>
      </Plate>
    </TooltipProvider>
  );
}
