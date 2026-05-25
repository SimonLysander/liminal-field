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
  useRef,
  useState,
  useTransition,
  useEffect,
} from 'react';
import { Plate, usePlateEditor } from 'platejs/react';
import { deserializeMd } from '@platejs/markdown';
import { motion } from 'motion/react';

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
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
 * deserializeMd 不认识 <date value="..."/> 标签。
 * 处理方式：在传给 deserializeMd 之前，直接在 markdown 字符串里替换。
 * 把 <date value="YYYY-MM-DD" /> 替换为一个特殊占位符 `%%DATE:YYYY-MM-DD%%`，
 * deserializeMd 后再递归扫描文本节点，把占位符还原为 Plate date 元素节点。
 */
/** 宽松的 Slate 节点结构（够本文件遍历日期占位符用，避免引入 Plate 完整联合类型） */
type SlateNodeLike = {
  text?: string;
  children?: SlateNodeLike[];
  [key: string]: unknown;
};

const DATE_TAG_RE = /<date\s+value="([^"]+)"\s*\/>/g;
const DATE_PLACEHOLDER_RE = /%%DATE:([^%]+)%%/g;

/** 第一步：markdown 字符串里把 <date> HTML 标签替换为纯文本占位符 */
function replaceDateTags(md: string): string {
  return md.replace(DATE_TAG_RE, '%%DATE:$1%%');
}

/** 第二步：Plate 节点树里把占位符还原为 date 元素节点 */
function restoreDateNodes(nodes: SlateNodeLike[]): SlateNodeLike[] {
  return nodes.map((node) => {
    if (node.children) {
      const newChildren: SlateNodeLike[] = [];
      for (const child of node.children) {
        if (child.text != null && DATE_PLACEHOLDER_RE.test(child.text)) {
          DATE_PLACEHOLDER_RE.lastIndex = 0;
          let lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = DATE_PLACEHOLDER_RE.exec(child.text)) !== null) {
            if (match.index > lastIndex) {
              newChildren.push({ ...child, text: child.text.slice(lastIndex, match.index) });
            }
            newChildren.push({
              type: 'date',
              date: match[1],
              children: [{ text: '' }],
            });
            lastIndex = match.index + match[0].length;
          }
          if (lastIndex < child.text.length) {
            newChildren.push({ ...child, text: child.text.slice(lastIndex) });
          }
        } else if (child.children) {
          newChildren.push(restoreDateNodes([child])[0]);
        } else {
          newChildren.push(child);
        }
      }
      return { ...node, children: newChildren };
    }
    return node;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留接口兼容
  contentItemId: _,
  /** Plate 异步就绪并为 h1–h6 打上 data-heading-id 之后调用（用于父组件从 DOM 聚合 TOC） */
  onHeadingsMarked,
}: {
  markdown: string;
  /** @deprecated 服务端已完成 URL 重写，此参数保留仅为接口兼容 */
  contentItemId?: string;
  onHeadingsMarked?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [isPending, startTransition] = useTransition();
  const onHeadingsMarkedRef = useRef(onHeadingsMarked);
  useEffect(() => {
    onHeadingsMarkedRef.current = onHeadingsMarked;
  }, [onHeadingsMarked]);

  // 服务端已将 ./assets/ 重写为 OSS 直连 URL（或代理 URL），客户端无需再处理
  const processedMarkdown = markdown || '';

  // markdown 变化时重置 ready，用 startTransition 延迟重建 editor
  useEffect(() => {
    void Promise.resolve().then(() => {
      setReady(false);
      startTransition(() => {
        setReady(true);
      });
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
    onHeadingsMarkedRef.current?.();
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
          /* 先把 <date value="..."/> 替换为占位符（避免 remark 把它当 HTML 处理），
           * 反序列化后再把占位符还原为 Plate date 节点 */
          const preprocessed = replaceDateTags(markdown);
          const nodes = deserializeMd(editor, preprocessed);
          return fixCodeBlockLines(
            restoreDateNodes(nodes) as unknown as Parameters<
              typeof fixCodeBlockLines
            >[0],
          );
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
