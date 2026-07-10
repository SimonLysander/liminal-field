/*
 * PlateReadOnly — PlateStatic 阅读器（异步化）
 *
 * 大文档（100 页+）的 Markdown 反序列化是 CPU 密集操作，会阻塞主线程。
 * 通过 startTransition 将解析和渲染标记为低优先级，
 * 先展示轻量 loading 骨架，保持 UI 响应。
 *
 * H1-H3 元素在渲染后通过 layout effect 标记 data-heading-id，
 * 供 TOC 面板提取目录结构。
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  useEffect,
  useMemo,
} from 'react';
import { createStaticEditor, PlateStatic } from 'platejs/static';
import { motion } from 'motion/react';

import { deserializeDocumentMarkdown } from './document-static/document-markdown';
import { StaticDocumentKit } from './document-static/document-static-kit';
import {
  getHeadingNumberingClass,
  type HeadingNumberingInput,
} from './heading-numbering';

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
  headingNumbering,
  /** Plate 异步就绪并为 h1–h3 打上 data-heading-id 之后调用（用于父组件从 DOM 聚合 TOC） */
  onHeadingsMarked,
}: {
  markdown: string;
  /** @deprecated 服务端已完成 URL 重写，此参数保留仅为接口兼容 */
  contentItemId?: string;
  headingNumbering?: HeadingNumberingInput;
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

  // markdown 变化时重置 ready，用 startTransition 延迟创建静态 editor。
  useEffect(() => {
    void Promise.resolve().then(() => {
      setReady(false);
      startTransition(() => {
        setReady(true);
      });
    });
  }, [processedMarkdown]);

  // 渲染后只标记 H1-H3；更深层级保留正文样式,但不进入阅读/编辑大纲。
  useLayoutEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3');
    headings.forEach((el, i) => {
      el.setAttribute('data-heading-id', `heading-${i}`);
    });
    onHeadingsMarkedRef.current?.();
  }, [ready, processedMarkdown]);

  if (!ready || isPending) {
    return <ReadOnlySkeleton />;
  }

  return (
    <div
      ref={containerRef}
      className={getHeadingNumberingClass(headingNumbering)}
      style={{ color: 'var(--ink-light)' }}
    >
      <StaticDocument markdown={processedMarkdown} />
    </div>
  );
}

function StaticDocument({ markdown }: { markdown: string }) {
  const editor = useMemo(
    () =>
      createStaticEditor({
        plugins: StaticDocumentKit,
        value: (staticEditor) =>
          deserializeDocumentMarkdown(staticEditor, markdown),
      }),
    [markdown],
  );

  return <PlateStatic editor={editor} />;
}
