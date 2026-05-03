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

import type { TElement } from 'platejs';

import { EditorKit } from '@/components/editor/editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FixedToolbar } from '@/components/ui/fixed-toolbar';
import { FixedToolbarButtons } from '@/components/ui/fixed-toolbar-buttons';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * deserializeMd 会把 code_block 的所有行合并成单个 code_line，
 * 丢失换行符。这里按 \n 拆分回多个 code_line 节点。
 */
function fixCodeBlockLines(nodes: TElement[]): TElement[] {
  return nodes.map((node) => {
    if (node.type !== 'code_block') return node;

    const fixedChildren: TElement[] = [];
    for (const child of node.children as TElement[]) {
      if (child.type !== 'code_line') {
        fixedChildren.push(child);
        continue;
      }
      const text = (child.children as { text: string }[])
        .map((c) => c.text)
        .join('');
      const lines = text.split('\n');
      for (const line of lines) {
        fixedChildren.push({
          type: 'code_line',
          children: [{ text: line }],
        } as TElement);
      }
    }

    return { ...node, children: fixedChildren };
  });
}

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
        } catch {
          return [{ type: 'p', children: [{ text: '' }] }];
        }
      },
    },
    [],
  );

  const handleChange = useCallback(() => {
    if (!editor) return;
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
