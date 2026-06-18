/**
 * /digest/:topicId/:reportId — 公开端「单篇报告」阅读页。
 *
 * 两栏布局：左/中正文（picks 拼成 markdown 渲染）+ 右 Aurora 追问占位栏。
 * Aurora 栏本次只做视觉占位，task #38 再真接 AdvisorSidebar。
 * 本页纯 mock 数据，不接 API。
 */
import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Lock, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { smoothBounce, appleEase } from '@/lib/motion';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { MarkdownTocPanel } from '@/components/shared/MarkdownTocPanel';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { MockReport, MockPick } from './mock-data';

/* ================================================================
 * Markdown 构造
 * 每份报告的正文由 picks 按固定格式拼成 markdown 字符串。
 * ================================================================ */

function buildMarkdown(report: MockReport, topicName: string): string {
  const d = new Date(report.date);
  const dateStr = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const isoStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const lines: string[] = [
    `# ${topicName} · ${dateStr}`,
    `> ${report.picks.length} 条精选 · 自动采集于 ${isoStr}`,
    '',
  ];

  report.picks.forEach((pick: MockPick, i: number) => {
    lines.push(`## ${pick.title}`);
    lines.push(`*来源：${pick.source} · [查看原文 →](${pick.url})*`);
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
        <span className="text-base" style={{ color: 'var(--ink-ghost)' }}>报告不存在</span>
      </div>
    );
  }

  const markdown = buildMarkdown(report, topic.name);

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">
      {/* 主体阅读区 */}
      <div ref={centerRef} className="flex-1 overflow-y-auto py-12">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">

          {/* 面包屑 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: appleEase }}
            className="mb-8 flex items-center gap-2 text-sm"
            style={{ color: 'var(--ink-ghost)' }}
          >
            <Link
              to="/digest"
              className="transition-colors duration-150 hover:text-[var(--ink)]"
            >
              精选
            </Link>
            <span>/</span>
            <Link
              to={`/digest/${topic.id}`}
              className="transition-colors duration-150 hover:text-[var(--ink)]"
            >
              <ChevronLeft size={13} strokeWidth={1.5} className="mr-0.5 inline-block" />
              {topic.name}
            </Link>
          </motion.div>

          {/* 正文 */}
          <motion.div
            className="note-prose text-lg leading-[1.9]"
            style={{ color: 'var(--ink-light)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, delay: 0.1, ease: smoothBounce }}
          >
            <MarkdownBody markdown={markdown} onHeadingsMarked={refreshToc} />
          </motion.div>

        </div>
      </div>

      {/* 右栏：Aurora 追问占位 — task #38 才真接 AdvisorSidebar */}
      <AuroraPlaceholder />

      {/* 右侧 TOC 面板（正文 markdown 标题目录） */}
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}

/* ================================================================
 * AuroraPlaceholder — Aurora 追问占位栏（视觉骨架，未登录态）
 * ================================================================ */

function AuroraPlaceholder() {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2, ease: appleEase }}
      className="hidden w-[240px] shrink-0 xl:flex xl:flex-col"
      style={{ paddingTop: '3rem', paddingRight: '1.5rem', paddingBottom: '2rem' }}
    >
      <div
        className="sticky top-16 flex flex-col gap-4 rounded-xl p-4"
        style={{ background: 'var(--shelf)', border: '0.5px solid var(--separator)' }}
      >
        {/* 栏头 */}
        <div className="flex items-center gap-2">
          <Sparkles size={14} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Aurora · 追问</span>
          <Lock size={12} strokeWidth={1.5} className="ml-auto" style={{ color: 'var(--ink-ghost)' }} />
        </div>

        {/* 未登录说明 */}
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          登录后可与 Aurora 追问这份报告，深入挖掘你感兴趣的细节。
        </p>

        {/* 登录按钮 */}
        <Link
          to="/login"
          className="flex items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-opacity duration-150 hover:opacity-80"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          登录后追问
        </Link>
      </div>
    </motion.aside>
  );
}
