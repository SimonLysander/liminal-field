/**
 * /digest — 精选刊目录页。
 *
 * 期刊范式：报头（刊名 + 卷次）+ 栏目目录列表。
 * 每个事项 = 一个专栏条目（单行，不用卡片网格），整行可点击进 /digest/:topicId。
 * 本页纯 mock 数据（./mock-data），不接 API（task #38 再接）。
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { PublicTopic } from './mock-data';

/* ================================================================
 * 工具函数
 * ================================================================ */

function daysAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

function reportCount(topicId: string): number {
  return MOCK_REPORTS.filter((r) => r.topicId === topicId).length;
}

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestPublicPage() {
  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-16 max-[520px]:px-5">

        {/* ── 报头区 ── */}
        <motion.header
          className="mb-12"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: appleEase }}
        >
          {/* 卷次行：small caps */}
          <p
            className="mb-4 text-xs uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            Vol. 1 · 2026
          </p>

          {/* 刊名 */}
          <h1
            className="mb-3 text-5xl font-bold leading-none tracking-tight"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            DIGEST · 精选
          </h1>

          {/* tagline */}
          <p
            className="mb-8 text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--ink-faded)' }}
          >
            选订自定 · AI 替你筛过 · 周期出刊
          </p>

          {/* 报头下方粗横线 */}
          <div style={{ borderBottom: '2px solid var(--ink)' }} />
        </motion.header>

        {/* ── 栏目目录 ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15, ease: appleEase }}
        >
          {/* 目录标签行 */}
          <p
            className="mb-6 text-xs uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            本期专栏
          </p>

          {MOCK_TOPICS.length === 0 ? (
            <EmptyTopics />
          ) : (
            <div className="flex flex-col">
              {MOCK_TOPICS.map((topic, i) => (
                <TopicRow key={topic.id} topic={topic} index={i} />
              ))}
            </div>
          )}
        </motion.section>

        {/* ── 版权页尾 ── */}
        <motion.footer
          className="mt-20 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.35, ease: appleEase }}
        >
          <div
            className="mb-8"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          />
          <p
            className="text-xs uppercase tracking-[0.18em]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            由 Aurora 协作维护 · 由你订阅
          </p>
        </motion.footer>

      </div>
    </div>
  );
}

/* ================================================================
 * TopicRow — 单个栏目条目（行式，非卡片）
 * ================================================================ */

function TopicRow({ topic, index }: { topic: PublicTopic; index: number }) {
  const count = reportCount(topic.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 * index, ease: appleEase }}
    >
      <Link
        to={`/digest/${topic.id}`}
        className="group flex items-baseline justify-between gap-6 py-6 transition-colors duration-150"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        {/* 左侧：栏目名 + 副标题 */}
        <div className="min-w-0 flex-1">
          <h2
            className="text-2xl font-bold leading-snug transition-colors duration-150 group-hover:opacity-80"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {topic.name}
          </h2>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: 'var(--ink-ghost)' }}
          >
            {topic.tagline}
          </p>
        </div>

        {/* 右侧：meta + 箭头 */}
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p
              className="text-xs uppercase tracking-[0.16em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {count} 期
            </p>
            <p
              className="mt-0.5 text-xs"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {daysAgo(topic.lastReportAt)}更新
            </p>
          </div>
          <ChevronRight
            size={15}
            strokeWidth={1.5}
            className="transition-transform duration-150 group-hover:translate-x-1"
            style={{ color: 'var(--ink-ghost)' }}
          />
        </div>
      </Link>
    </motion.div>
  );
}

/* ================================================================
 * EmptyTopics
 * ================================================================ */

function EmptyTopics() {
  return (
    <div
      className="py-24 text-center"
      style={{ borderTop: '0.5px solid var(--separator)', borderBottom: '0.5px solid var(--separator)' }}
    >
      <p
        className="text-xs uppercase tracking-[0.18em]"
        style={{ color: 'var(--ink-ghost)' }}
      >
        暂无专栏
      </p>
    </div>
  );
}
