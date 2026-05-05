/*
 * PlateReadOnly — Plate read-only 渲染器（异步化）
 *
 * 大文档（100 页+）的 deserializeMd 是 CPU 密集操作，会阻塞主线程。
 * 通过 startTransition 将解析和渲染标记为低优先级，
 * 先展示轻量 loading 骨架，保持 UI 响应。
 *
 * heading 元素在渲染后通过 layout effect 标记 data-heading-id，
 * 供 TOC 面板提取目录结构。
 */

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useEffect,
} from 'react';
import { Plate, usePlateEditor } from 'platejs/react';
import { deserializeMd } from '@platejs/markdown';
import type { TElement } from 'platejs';
import { motion } from 'motion/react';

import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit';
import { CodeBlockKit } from '@/components/editor/plugins/code-block-kit';
import { DateKit } from '@/components/editor/plugins/date-kit';
import { LinkKit } from '@/components/editor/plugins/link-kit';
import { ListKit } from '@/components/editor/plugins/list-kit';
import { TableKit } from '@/components/editor/plugins/table-kit';
import { MediaKit } from '@/components/editor/plugins/media-kit';
import { FontKit } from '@/components/editor/plugins/font-kit';
import { MathKit } from '@/components/editor/plugins/math-kit';
import { Editor } from '@/components/ui/editor';
import { MarkdownPlugin } from '@platejs/markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/**
 * read-only 插件集：不含 remarkMdx。
 * remarkMdx 会把 { }、< > 等当 JSX/表达式解析，遇到 LaTeX 残留会静默截断内容。
 */
const ReadOnlyPlugins = [
  ...BasicNodesKit,
  ...CodeBlockKit,
  ...DateKit,
  ...LinkKit,
  ...ListKit,
  ...TableKit,
  ...MediaKit,
  ...FontKit,
  ...MathKit,
  MarkdownPlugin.configure({
    options: { remarkPlugins: [remarkGfm, remarkMath] },
  }),
];

/**
 * deserializeMd 会把 code_block 的所有行合并成单个 code_line，
 * 按 \n 拆分回多个 code_line 节点。
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

/** 骨架屏：模拟文本行的脉冲条，比文字更自然 */
function ReadOnlySkeleton() {
  const widths = ['85%', '70%', '90%', '60%', '80%', '45%'];
  return (
    <motion.div
      className="space-y-3 py-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {widths.map((w, i) => (
        <motion.div
          key={i}
          className="h-3 rounded-sm"
          style={{ width: w, background: 'var(--shelf)' }}
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
        />
      ))}
    </motion.div>
  );
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
  const [ready, setReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  const processedMarkdown = useMemo(() => {
    let md = markdown || '';
    if (contentItemId) {
      md = md.replaceAll(/\.\/assets\//g, `/api/v1/spaces/notes/items/${contentItemId}/assets/`);
    }
    return md;
  }, [markdown, contentItemId]);

  // markdown 变化时重置 ready，用 startTransition 延迟重建 editor
  useEffect(() => {
    setReady(false);
    startTransition(() => {
      setReady(true);
    });
  }, [processedMarkdown]);

  // 渲染后标记 heading ID，供 TOC 提取
  useLayoutEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((el, i) => {
      el.setAttribute('data-heading-id', `heading-${i}`);
    });
  }, [ready, processedMarkdown]);

  if (!ready || isPending) {
    return <ReadOnlySkeleton />;
  }

  return (
    <div ref={containerRef} style={{ color: 'var(--ink-light)' }}>
      <PlateReadOnlyInner markdown={processedMarkdown} />
    </div>
  );
}

/**
 * 内层组件：usePlateEditor 必须在 ready 之后才调用，
 * 避免在 transition pending 期间创建重量级 editor 实例。
 */
function PlateReadOnlyInner({ markdown }: { markdown: string }) {
  const reactId = useId();
  const editorId = `plate-readonly-${reactId}`;
  const editor = usePlateEditor(
    {
      id: editorId,
      plugins: ReadOnlyPlugins,
      value: (editor) => {
        try {
          const nodes = deserializeMd(editor, markdown);
          return fixCodeBlockLines(nodes);
        } catch (err) {
          console.error('[PlateReadOnly] deserializeMd failed:', err);
          return [{ type: 'p', children: [{ text: markdown }] }];
        }
      },
    },
    [markdown],
  );

  return (
    <Plate editor={editor} readOnly>
      <Editor variant="none" readOnly />
    </Plate>
  );
}
