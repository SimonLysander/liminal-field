/*
 * PlateReadOnly — Plate read-only 渲染器
 *
 * 用与编辑器相同的插件和组件渲染 markdown，确保编辑端和展示端 100% 视觉一致。
 * 不加载编辑交互（DnD、ExitBreak、TrailingBlock），只保留渲染所需的插件。
 *
 * heading 元素在渲染后通过 layout effect 标记 data-heading-id，
 * 供 TOC 面板提取目录结构。
 */

import { useLayoutEffect, useMemo, useRef } from 'react';
import { Plate, usePlateEditor } from 'platejs/react';
import { deserializeMd } from '@platejs/markdown';
import type { TElement } from 'platejs';

import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit';
import { CodeBlockKit } from '@/components/editor/plugins/code-block-kit';
import { DateKit } from '@/components/editor/plugins/date-kit';
import { LinkKit } from '@/components/editor/plugins/link-kit';
import { ListKit } from '@/components/editor/plugins/list-kit';
import { TableKit } from '@/components/editor/plugins/table-kit';
import { MediaKit } from '@/components/editor/plugins/media-kit';
import { FontKit } from '@/components/editor/plugins/font-kit';
import { MarkdownKit } from '@/components/editor/plugins/markdown-kit';
import { Editor } from '@/components/ui/editor';

/** read-only 只需渲染插件，不需要编辑交互（DnD、ExitBreak、TrailingBlock） */
const ReadOnlyPlugins = [
  ...BasicNodesKit,
  ...CodeBlockKit,
  ...DateKit,
  ...LinkKit,
  ...ListKit,
  ...TableKit,
  ...MediaKit,
  ...FontKit,
  ...MarkdownKit,
];

/**
 * deserializeMd 会把 code_block 的所有行合并成单个 code_line，
 * 按 \n 拆分回多个 code_line 节点。与 PlateEditor.tsx 的同名函数逻辑一致。
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
      const text = (child.children as { text: string }[]).map((c) => c.text).join('');
      for (const line of text.split('\n')) {
        fixedChildren.push({ type: 'code_line', children: [{ text: line }] } as TElement);
      }
    }
    return { ...node, children: fixedChildren };
  });
}

export default function PlateReadOnly({
  markdown,
  contentItemId,
}: {
  markdown: string;
  /** 传入后将 ./assets/{name} 改写为服务端代理 URL */
  contentItemId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const processedMarkdown = useMemo(() => {
    let md = markdown || '';

    // 资源路径改写：./assets/ → API 代理 URL
    if (contentItemId) {
      md = md.replaceAll(/\.\/assets\//g, `/api/v1/spaces/notes/items/${contentItemId}/assets/`);
    }

    // 转义 fenced code block 和 inline code 之外的 { }，
    // 防止 remarkMdx 把它们当 JSX 表达式解析导致静默截断
    const lines = md.split('\n');
    const escaped: string[] = [];
    let inCodeBlock = false;
    for (const line of lines) {
      if (/^```/.test(line)) { inCodeBlock = !inCodeBlock; escaped.push(line); continue; }
      if (inCodeBlock) { escaped.push(line); continue; }
      escaped.push(line.replace(/(`[^`]*`)|([{}])/g, (_match, code, brace) =>
        code ? code : brace === '{' ? '\\{' : '\\}',
      ));
    }
    return escaped.join('\n');
  }, [markdown, contentItemId]);

  const editor = usePlateEditor(
    {
      plugins: ReadOnlyPlugins,
      value: (editor) => {
        try {
          const nodes = deserializeMd(editor, processedMarkdown);
          return fixCodeBlockLines(nodes);
        } catch (err) {
          console.error('[PlateReadOnly] deserializeMd failed, falling back to plain text:', err);
          return [{ type: 'p', children: [{ text: processedMarkdown }] }];
        }
      },
    },
    // key 绑定 markdown 内容，内容变化时重建 editor
    [processedMarkdown],
  );

  // 渲染后标记 heading ID，供 TOC 提取
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((el, i) => {
      el.setAttribute('data-heading-id', `heading-${i}`);
    });
  }, [processedMarkdown]);

  return (
    <div ref={containerRef} style={{ color: 'var(--ink-light)' }}>
      <Plate editor={editor} readOnly>
        <Editor variant="none" readOnly />
      </Plate>
    </div>
  );
}
