/**
 * /digest — 精选刊目录页。
 *
 * 真报纸头版：粗黑横线 + 巨型刊名 + Vol/No small caps 行 + 单列栏目目录。
 * 设计原则：全靠排版层级，去 icon 去卡片背景，横线即结构。
 */
import { Link } from 'react-router-dom';
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
          className="mb-0"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          {/* 卷次行 */}
          <p
            className="mb-5 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
          >
            Vol. 1 &nbsp;·&nbsp; No. 12 &nbsp;·&nbsp; 2026-06-18 &nbsp;·&nbsp; 由 Aurora 编辑
          </p>

          {/* 巨型刊名 */}
          <h1
            className="mb-4 text-7xl font-bold leading-[0.95] tracking-tight max-[520px]:text-5xl"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            DIGEST · 精选
          </h1>

          {/* 副标题 tagline — italic serif */}
          <p
            className="mb-6 text-xl italic leading-snug"
            style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
          >
            本期关注 · AI 应用发展 · 摄影活动 · 写作叙事
          </p>

          {/* 报头下方 3px 粗黑横线 */}
          <div style={{ borderBottom: '3px solid var(--ink)' }} />
        </motion.header>

        {/* ── 栏目目录 ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.12, ease: appleEase }}
        >
          {/* 目录标签行 */}
          <p
            className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
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
          transition={{ duration: 0.3, delay: 0.25, ease: appleEase }}
        >
          <div style={{ borderTop: '3px solid var(--ink)' }} />
          <p
            className="mt-6 text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            Printed by Aurora &nbsp;·&nbsp; Subscribed by You
          </p>
        </motion.footer>

      </div>
    </div>
  );
}

/* ================================================================
 * TopicRow — 单个栏目条目（行式，纯排版，无卡片无图标）
 * ================================================================ */

function TopicRow({ topic, index }: { topic: PublicTopic; index: number }) {
  const count = reportCount(topic.id);

  return (
    <div>
      {/* 行间黑色分隔线（1px 黑，比 separator 深得多） */}
      <div style={{ borderTop: '1px solid var(--ink)' }} />

      <Link
        to={`/digest/${topic.id}`}
        className="group flex items-baseline justify-between gap-6 py-6 transition-opacity duration-150 hover:opacity-70"
        style={{ animationDelay: `${0.06 * index}s` }}
      >
        {/* 左侧：栏目名 + italic 副标题 */}
        <div className="min-w-0 flex-1">
          <h2
            className="text-3xl font-bold leading-snug tracking-tight"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {topic.name}
          </h2>
          <p
            className="mt-1.5 text-base italic leading-relaxed"
            style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
          >
            {topic.tagline}
          </p>
        </div>

        {/* 右侧：small caps meta + ASCII 箭头 */}
        <div className="flex shrink-0 items-center gap-6">
          <div className="text-right">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.28em]"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {count} 期
            </p>
            <p
              className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            >
              {daysAgo(topic.lastReportAt)} 更新
            </p>
          </div>
          <span
            className="text-base font-bold transition-transform duration-150 group-hover:translate-x-1"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            →
          </span>
        </div>
      </Link>
    </div>
  );
}

/* ================================================================
 * EmptyTopics
 * ================================================================ */

function EmptyTopics() {
  return (
    <div
      className="py-24 text-center"
      style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        暂无专栏
      </p>
    </div>
  );
}
