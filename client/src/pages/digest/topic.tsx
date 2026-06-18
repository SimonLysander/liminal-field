/**
 * /digest/:topicId — 专栏首页（往期列表）。
 *
 * 期刊范式：栏目报头 + 往期行式列表（第 N 期，不用卡片）。
 * 点击某行进 /digest/:topicId/:reportId。
 * 本页纯 mock 数据（./mock-data），不接 API（task #38 再接）。
 */
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { MockReport } from './mock-data';

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestTopicPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const topic = MOCK_TOPICS.find((t) => t.id === topicId);
  const reports = MOCK_REPORTS.filter((r) => r.topicId === topicId);

  if (!topic) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className="text-xs uppercase tracking-[0.18em]"
          style={{ color: 'var(--ink-ghost)' }}
        >
          栏目不存在
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-16 max-[520px]:px-5">

        {/* ── breadcrumb ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
          className="mb-12"
        >
          <Link
            to="/digest"
            className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.18em] transition-opacity duration-150 hover:opacity-60"
            style={{ color: 'var(--ink-ghost)' }}
          >
            <ChevronLeft size={12} strokeWidth={1.5} />
            返回目录
          </Link>
        </motion.div>

        {/* ── 栏目报头 ── */}
        <motion.header
          className="mb-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: appleEase }}
        >
          {/* 专栏标签 */}
          <p
            className="mb-4 text-xs uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            Column · 专栏
          </p>

          {/* 栏目名 */}
          <h1
            className="mb-3 text-5xl font-bold leading-none tracking-tight"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {topic.name}
          </h1>

          {/* 描述 */}
          <p
            className="mb-6 text-base leading-relaxed"
            style={{ color: 'var(--ink-faded)' }}
          >
            {topic.description}
          </p>

          {/* meta 行：期数 · 信息源 · 节奏 */}
          <p
            className="mb-8 text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            总 {reports.length} 期
            <span className="mx-3" style={{ color: 'var(--separator)' }}>·</span>
            订阅 {topic.sourceCount} 个信息源
            <span className="mx-3" style={{ color: 'var(--separator)' }}>·</span>
            {topic.cronLabel}
          </p>

          {/* 报头粗横线 */}
          <div style={{ borderBottom: '1px solid var(--ink)' }} />
        </motion.header>

        {/* ── 往期列表 ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.2, ease: appleEase }}
        >
          {reports.length === 0 ? (
            <EmptyReports />
          ) : (
            <div className="flex flex-col">
              {reports.map((report, i) => (
                <IssueRow
                  key={report.id}
                  report={report}
                  topicId={topic.id}
                  index={i}
                />
              ))}
            </div>
          )}
        </motion.section>

      </div>
    </div>
  );
}

/* ================================================================
 * IssueRow — 单期行式条目
 * ================================================================ */

function IssueRow({
  report,
  topicId,
  index,
}: {
  report: MockReport;
  topicId: string;
  index: number;
}) {
  const previewPicks = report.picks.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 * index, ease: appleEase }}
    >
      <Link
        to={`/digest/${topicId}/${report.id}`}
        className="group flex items-start gap-8 py-7 transition-colors duration-150 hover:opacity-80"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        {/* 左：期号 */}
        <div className="w-16 shrink-0 pt-0.5">
          <p
            className="text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            第 {report.issueNumber} 期
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: 'var(--ink-ghost)' }}
          >
            {formatDateShort(report.date)}
          </p>
        </div>

        {/* 中：picks 预览 */}
        <div className="min-w-0 flex-1">
          {/* 本期标题（如有） */}
          {report.headline && (
            <p
              className="mb-2 text-base font-semibold leading-snug"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {report.headline}
            </p>
          )}

          {/* 前 3 条 pick 标题行 */}
          <ul className="flex flex-col gap-1.5">
            {previewPicks.map((pick) => (
              <li key={pick.url} className="flex items-baseline gap-2">
                <span
                  className="shrink-0 text-xs uppercase tracking-[0.14em]"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  {pick.source}
                </span>
                <span
                  className="truncate text-sm leading-snug"
                  style={{ color: 'var(--ink-faded)' }}
                >
                  {pick.title}
                </span>
              </li>
            ))}
            {report.picks.length > 3 && (
              <li
                className="text-xs"
                style={{ color: 'var(--ink-ghost)' }}
              >
                +{report.picks.length - 3} 条…
              </li>
            )}
          </ul>
        </div>

        {/* 右：阅读箭头 */}
        <div
          className="shrink-0 pt-0.5 text-xs uppercase tracking-[0.18em] transition-all duration-150 group-hover:translate-x-1"
          style={{ color: 'var(--ink-ghost)' }}
        >
          阅读 →
        </div>
      </Link>
    </motion.div>
  );
}

/* ================================================================
 * EmptyReports
 * ================================================================ */

function EmptyReports() {
  return (
    <div
      className="py-24 text-center"
      style={{ borderTop: '0.5px solid var(--separator)', borderBottom: '0.5px solid var(--separator)' }}
    >
      <p
        className="text-xs uppercase tracking-[0.18em]"
        style={{ color: 'var(--ink-ghost)' }}
      >
        本专栏尚无出刊记录
      </p>
    </div>
  );
}
