/**
 * /digest/:topicId — 公开端「事项报告流」页。
 *
 * 展示单个采集事项的所有历史报告，按时间倒序排列。
 * 每条报告卡显示日期、命中数以及前 3 条 pick 预览，点击进 /digest/:topicId/:reportId。
 * 本页纯 mock 数据（来自 ./mock-data），不接 API（task #38 再接）。
 */
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar, Sparkles, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { smoothBounce, appleEase } from '@/lib/motion';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { MockReport, MockPick } from './mock-data';

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
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
        <span className="text-base" style={{ color: 'var(--ink-ghost)' }}>事项不存在</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-12 max-[520px]:px-4">

        {/* 面包屑 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          <Link
            to="/digest"
            className="mb-8 inline-flex items-center gap-1 text-sm transition-colors duration-150 hover:text-[var(--ink)]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
            返回精选
          </Link>
        </motion.div>

        {/* 事项标题 + 描述 */}
        <motion.h1
          className="mb-3 text-4xl font-bold leading-snug tracking-tight"
          style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {topic.name}
        </motion.h1>

        <motion.p
          className="mb-10 text-base"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15, ease: appleEase }}
        >
          {topic.description}
        </motion.p>

        {/* 报告时间线 */}
        {reports.length === 0 ? (
          <EmptyReports />
        ) : (
          <motion.div
            className="flex flex-col gap-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2, ease: appleEase }}
          >
            {reports.map((report, i) => (
              <ReportCard key={report.id} report={report} topicId={topic.id} index={i} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * ReportCard — 单份报告预览卡
 * ================================================================ */

function ReportCard({ report, topicId, index }: { report: MockReport; topicId: string; index: number }) {
  const previewPicks = report.picks.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: appleEase }}
      className="rounded-xl p-5"
      style={{ background: 'var(--shelf)', border: '0.5px solid var(--separator)' }}
    >
      {/* 报告日期 + 命中数 */}
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-xl font-semibold"
          style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
        >
          <Calendar size={14} strokeWidth={1.5} className="mr-1.5 inline-block" style={{ color: 'var(--ink-ghost)' }} />
          {formatDate(report.date)}
        </h3>
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {report.picks.length} 条精选
        </span>
      </div>

      {/* picks 预览（前 3 条） */}
      <ul className="mb-4 flex flex-col gap-3">
        {previewPicks.map((pick: MockPick) => (
          <li key={pick.url}>
            <div className="text-sm font-medium leading-snug" style={{ color: 'var(--ink)' }}>
              {pick.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
              <ExternalLink size={10} strokeWidth={1.5} />
              {pick.source}
            </div>
            <p className="mt-1 line-clamp-1 text-xs leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
              {pick.snippet}
            </p>
          </li>
        ))}
        {report.picks.length > 3 && (
          <li className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            还有 {report.picks.length - 3} 条…
          </li>
        )}
      </ul>

      {/* 查看完整报告链接 */}
      <Link
        to={`/digest/${topicId}/${report.id}`}
        className="inline-flex items-center gap-1 text-sm font-medium transition-colors duration-150 hover:text-[var(--ink)]"
        style={{ color: 'var(--accent)' }}
      >
        查看完整报告
        <ChevronRight size={14} strokeWidth={1.5} />
      </Link>
    </motion.div>
  );
}

function EmptyReports() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl py-24"
      style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
    >
      <Sparkles size={32} strokeWidth={1.5} />
      <p className="text-base font-medium">这个事项还没有报告</p>
    </div>
  );
}
