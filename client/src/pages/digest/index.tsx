/**
 * /digest — 公开端「精选」事项列表页。
 *
 * 展示所有已配置的采集事项，每卡点击进 /digest/:topicId 查看历史报告流。
 * 本页纯 mock 数据，不接 API（task #38 再接真实后端）。
 */
import { Link } from 'react-router-dom';
import { Sparkles, Rss, Calendar, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { smoothBounce, appleEase } from '@/lib/motion';

/* ================================================================
 * 类型 & Mock 数据
 * ================================================================ */

interface PublicTopic {
  id: string;
  name: string;
  description: string;
  sourceCount: number;
  cronLabel: string;
  lastReportAt: string; // ISO
  lastReportHits: number;
}

const MOCK_TOPICS: PublicTopic[] = [
  {
    id: 'ci_topic_ai001',
    name: 'AI 应用发展',
    description: '关注大模型应用、agent 框架、产品形态、行业资讯',
    sourceCount: 3,
    cronLabel: '每天更新',
    lastReportAt: '2026-06-18T08:00:00Z',
    lastReportHits: 5,
  },
  {
    id: 'ci_topic_photo02',
    name: '摄影活动举办',
    description: '关注国内外摄影展、比赛、工作坊、新书发布',
    sourceCount: 2,
    cronLabel: '每周更新',
    lastReportAt: '2026-06-17T09:00:00Z',
    lastReportHits: 2,
  },
  {
    id: 'ci_topic_writing',
    name: '写作 · 叙事 · 文学',
    description: '关注创作技艺、叙事理论、文学评论、出版动态',
    sourceCount: 4,
    cronLabel: '每 3 天更新',
    lastReportAt: '2026-06-15T00:00:00Z',
    lastReportHits: 8,
  },
];

/* ================================================================
 * 工具函数
 * ================================================================ */

/** 把 ISO 日期转成"X 天前"的口语化描述 */
function daysAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestPublicPage() {
  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-12 max-[520px]:px-4">

        {/* 页面标题区 */}
        <motion.div
          className="mb-3 flex items-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          <Sparkles size={26} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <h1
            className="text-4xl font-bold"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            精选
          </h1>
        </motion.div>

        <motion.p
          className="mb-10 text-base"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1, ease: appleEase }}
        >
          我关心的话题，每天替我筛选一份精选 — 自动采集 + AI 判定 + Aurora 追问。
        </motion.p>

        {/* 事项卡片网格 */}
        {MOCK_TOPICS.length === 0 ? (
          <EmptyTopics />
        ) : (
          <motion.div
            className="grid gap-4 md:grid-cols-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.15, ease: appleEase }}
          >
            {MOCK_TOPICS.map((topic, i) => (
              <TopicCard key={topic.id} topic={topic} index={i} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * TopicCard — 单个事项卡片
 * ================================================================ */

function TopicCard({ topic, index }: { topic: PublicTopic; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: appleEase }}
    >
      <Link
        to={`/digest/${topic.id}`}
        className="group flex flex-col gap-3 rounded-xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
        style={{
          background: 'var(--shelf)',
          border: '0.5px solid var(--separator)',
        }}
      >
        {/* 事项名 */}
        <h2
          className="text-2xl font-bold leading-snug"
          style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
        >
          {topic.name}
        </h2>

        {/* 描述 */}
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          {topic.description}
        </p>

        {/* meta 行 */}
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          <span className="flex items-center gap-1">
            <Rss size={12} strokeWidth={1.5} />
            {topic.sourceCount} 个信息源
          </span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Calendar size={12} strokeWidth={1.5} />
            {topic.cronLabel}
          </span>
          <span>·</span>
          <span>最近 {daysAgo(topic.lastReportAt)}</span>
        </div>

        {/* 底部：命中数 chip + 箭头 */}
        <div className="flex items-center justify-between">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: 'var(--paper)', color: 'var(--ink-faded)', border: '0.5px solid var(--separator)' }}
          >
            最近一份 {topic.lastReportHits} 条精选
          </span>
          <ChevronRight
            size={16}
            strokeWidth={1.5}
            className="transition-transform duration-150 group-hover:translate-x-0.5"
            style={{ color: 'var(--ink-ghost)' }}
          />
        </div>
      </Link>
    </motion.div>
  );
}

function EmptyTopics() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl py-24"
      style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
    >
      <Sparkles size={32} strokeWidth={1.5} />
      <p className="text-base font-medium">还没有发布的事项</p>
    </div>
  );
}
