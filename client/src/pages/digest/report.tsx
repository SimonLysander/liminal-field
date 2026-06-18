/**
 * /digest/:topicId/:reportId — 单期阅读页。
 *
 * 期刊范式：报头（期号 + 日期 + 衬线大标题）+ picks markdown 正文 + 右栏 Aurora 占位。
 * MarkdownBody 不改，只在外层容器加子选择器 className 影响 h2 字体（[&_h2] 前缀）。
 * 本页纯 mock 数据（./mock-data），不接 API（task #38 再接）。
 */
import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { appleEase, smoothBounce } from '@/lib/motion';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { MarkdownTocPanel } from '@/components/shared/MarkdownTocPanel';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { MockReport, MockPick } from './mock-data';

/* ================================================================
 * Markdown 构造
 * picks 拼成 markdown 正文，H2 = 条目标题（供 TOC 提取）。
 * ================================================================ */

function buildMarkdown(report: MockReport): string {
  const lines: string[] = [];

  report.picks.forEach((pick: MockPick, i: number) => {
    lines.push(`## ${i + 1}. ${pick.title}`);
    lines.push(`*${pick.source} · [查看原文 →](${pick.url})*`);
    lines.push('');
    lines.push(pick.snippet);
    lines.push('');
    if (i < report.picks.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  return lines.join('\n');
}

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestReportPage() {
  const { topicId, reportId } = useParams<{ topicId: string; reportId: string }>();

  const topic = MOCK_TOPICS.find((t) => t.id === topicId);
  const report = MOCK_REPORTS.find((r) => r.id === reportId && r.topicId === topicId);

  // TOC：MarkdownBody 渲染完成后从 DOM 提取 heading，与 anthology EntryReader 同模式
  const centerRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string; level: number }>>([]);
  const refreshToc = useCallback(() => {
    if (!centerRef.current) return;
    const els = Array.from(
      centerRef.current.querySelectorAll('[data-heading-id]'),
    ) as HTMLElement[];
    setToc(
      els.map((el) => ({
        id: el.getAttribute('data-heading-id') ?? '',
        text: el.textContent ?? '',
        level: parseInt(el.tagName.slice(1), 10) || 1,
      })),
    );
  }, []);

  if (!topic || !report) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className="text-xs uppercase tracking-[0.18em]"
          style={{ color: 'var(--ink-ghost)' }}
        >
          报告不存在
        </p>
      </div>
    );
  }

  const markdown = buildMarkdown(report);
  const headline = report.headline ?? '本期精选';

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">

      {/* ── 主体阅读区 ── */}
      <div ref={centerRef} className="flex-1 overflow-y-auto py-16">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-5">

          {/* breadcrumb */}
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: appleEase }}
            className="mb-12 flex items-center gap-2 text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--ink-ghost)' }}
            aria-label="面包屑"
          >
            <Link
              to="/digest"
              className="transition-opacity duration-150 hover:opacity-60"
            >
              目录
            </Link>
            <span>/</span>
            <Link
              to={`/digest/${topic.id}`}
              className="transition-opacity duration-150 hover:opacity-60"
            >
              {topic.name}
            </Link>
          </motion.nav>

          {/* ── 报头 ── */}
          <motion.header
            className="mb-12"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: smoothBounce }}
          >
            {/* 期号 + 日期行：small caps */}
            <p
              className="mb-4 text-xs uppercase tracking-[0.22em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              第 {report.issueNumber} 期 · {formatDate(report.date)}
            </p>

            {/* 栏目名（副标题级别） */}
            <p
              className="mb-2 text-xl font-medium leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {topic.name}
            </p>

            {/* 本期标题：衬线大字 */}
            <h1
              className="mb-5 text-4xl font-bold leading-tight tracking-tight"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {headline}
            </h1>

            {/* meta 行 */}
            <p
              className="mb-8 text-xs uppercase tracking-[0.18em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              共 {report.picks.length} 条 · 自动采集 + AI 判定
            </p>

            {/* 报头粗横线 */}
            <div style={{ borderBottom: '1px solid var(--ink)' }} />
          </motion.header>

          {/* ── 正文 ── */}
          {/* [&_h2] 子选择器让 MarkdownBody 渲染的 H2 使用衬线字体（MarkdownBody 本身不改）*/}
          <motion.div
            className="note-prose text-base leading-[1.9] [&_h2]:font-serif"
            style={{ color: 'var(--ink-light)' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: appleEase }}
          >
            <MarkdownBody markdown={markdown} onHeadingsMarked={refreshToc} />
          </motion.div>

          {/* ── 页尾仪式感结语 ── */}
          <motion.div
            className="mt-16 pb-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.3, ease: appleEase }}
          >
            <div
              className="mb-8"
              style={{ borderTop: '0.5px solid var(--separator)' }}
            />
            <p
              className="text-xs uppercase tracking-[0.22em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              —— 本期完 ——
            </p>
          </motion.div>

        </div>
      </div>

      {/* ── 右栏：Aurora 追问占位 ── */}
      <AuroraPlaceholder />

      {/* TOC 面板 */}
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}

/* ================================================================
 * AuroraPlaceholder — 期刊风 Aurora 追问占位
 * ================================================================ */

function AuroraPlaceholder() {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.25, ease: appleEase }}
      className="hidden w-[240px] shrink-0 xl:flex xl:flex-col"
      style={{ paddingTop: '4rem', paddingRight: '1.5rem', paddingBottom: '2rem' }}
    >
      <div className="sticky top-16 flex flex-col gap-5">
        {/* 期刊风栏头：small caps */}
        <div>
          <p
            className="mb-3 text-xs uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            Editorial · 编辑追问
          </p>
          <div style={{ borderBottom: '0.5px solid var(--separator)' }} />
        </div>

        {/* 说明 */}
        <p
          className="text-xs leading-relaxed"
          style={{ color: 'var(--ink-faded)' }}
        >
          登录后可与 Aurora 追问本期，深入挖掘你感兴趣的细节。
        </p>

        {/* 登录按钮 */}
        <Link
          to="/login"
          className="flex items-center gap-1.5 text-xs uppercase tracking-[0.16em] transition-opacity duration-150 hover:opacity-70"
          style={{ color: 'var(--ink-ghost)' }}
        >
          <Lock size={10} strokeWidth={1.5} />
          登录后追问
        </Link>

        {/* Aurora 图标装饰 */}
        <div className="mt-2 flex items-center gap-1.5">
          <Sparkles
            size={12}
            strokeWidth={1.5}
            style={{ color: 'var(--accent)' }}
          />
          <span
            className="text-xs uppercase tracking-[0.14em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            Aurora
          </span>
        </div>
      </div>
    </motion.aside>
  );
}
