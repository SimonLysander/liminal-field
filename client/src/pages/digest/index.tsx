/**
 * /digest — 精选刊目录页。
 *
 * task #52：接真实 API，从 mock 切换到 digestPublicApi.listTopics。
 *
 * 真报纸头版：粗黑横线 + 巨型刊名 + Vol/No small caps 行 + 单列栏目目录。
 * 设计原则：全靠排版层级，去 icon 去卡片背景，横线即结构。
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { digestPublicApi } from '@/services/digest-public';
import type { PublicTopicData } from '@/services/digest-public';

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

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestPublicPage() {
  const [topics, setTopics] = useState<PublicTopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    digestPublicApi
      .listTopics()
      .then((res) => {
        setTopics(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        const msg = err instanceof Error ? err.message : '加载失败，请稍后重试';
        setError(msg);
      });
  }, []);

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      {/* 容器宽度统一 1240(跟 /digest/:topicId 栏目页一致),避免翻页时边界忽宽忽窄 */}
      <div className="mx-auto w-full max-w-[1240px] px-10 py-16 max-[520px]:px-5">

        {/* ── 报头区 ── */}
        <motion.header
          className="mb-0"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          {/* 卷次行（动态日期） */}
          <p
            className="mb-5 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
          >
            由 Aurora 编辑 &nbsp;·&nbsp; 自动更新
          </p>

          {/* 巨型刊名 */}
          <h1
            className="mb-4 text-7xl font-bold leading-[0.95] tracking-tight max-[520px]:text-5xl"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            DIGEST · 简报
          </h1>

          {/* 副标题 tagline — italic serif */}
          <p
            className="mb-6 text-xl italic leading-snug"
            style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
          >
            {topics.length > 0
              ? topics.map((t) => t.name).join(' · ')
              : '智能采集 · AI 简报'}
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

          {loading ? (
            /* loading 骨架 */
            <div className="flex flex-col">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} style={{ borderTop: '1px solid var(--ink)' }}>
                  <div className="py-6 flex items-center justify-between gap-6">
                    <div className="flex-1 space-y-2">
                      <div className="h-8 w-48 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
                      <div className="h-4 w-72 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
                    </div>
                    <div className="h-4 w-16 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div
              className="py-16 text-center"
              style={{ borderTop: '1px solid var(--ink)' }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-[0.28em]"
                style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
              >
                {error}
              </p>
            </div>
          ) : topics.length === 0 ? (
            <EmptyTopics />
          ) : (
            <div className="flex flex-col">
              {topics.map((topic, i) => (
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

function TopicRow({ topic, index }: { topic: PublicTopicData; index: number }) {
  const count = topic.reports.length;
  const latest = topic.reports[0];

  return (
    <div>
      {/* 行间黑色分隔线（1px 黑，比 separator 深得多） */}
      <div style={{ borderTop: '1px solid var(--ink)' }} />

      <Link
        to={`/digest/${topic.id}`}
        className="group block py-10 transition-opacity duration-150 hover:opacity-80"
        style={{ animationDelay: `${0.06 * index}s` }}
      >
        {/* broadsheet 横块:左栏目元信息(masthead+宗旨+byline) | 右本期 hero — 非对称 7:5 比 */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">

          {/* ── 左 7/12:栏目元信息 ── */}
          <div className="md:col-span-7 flex flex-col">
            {/* kicker 小字标签 */}
            <p
              className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            >
              专栏 · COLUMN
            </p>

            {/* masthead 大字栏目名 */}
            <h2
              className="text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {topic.name}
            </h2>

            {/* standfirst italic 栏目宗旨 */}
            {topic.description && (
              <p
                className="mt-3 text-lg italic leading-snug"
                style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
              >
                {topic.description}
              </p>
            )}

            {/* 栏目元信息行 — 节奏/源数/期数都是本栏独有,不再写 Aurora
                (刊头已经说"由 AURORA 编辑",这层透传过来就是噪音) */}
            <p
              className="mt-auto pt-4 text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            >
              {topic.cadence ?? '手动出刊'}
              {typeof topic.sourceCount === 'number' && topic.sourceCount > 0 && (
                <>
                  <span className="mx-2">·</span>
                  {topic.sourceCount} 信息源
                </>
              )}
              <span className="mx-2">·</span>
              {count} 期
            </p>
          </div>

          {/* ── 右 5/12:本期 hero — 类似报纸 lead story 预告 ── */}
          <div className="md:col-span-5 md:border-l md:pl-8" style={{ borderColor: 'var(--separator)' }}>
            {latest ? (
              <>
                {/* small caps:LATEST ISSUE · 期号 · 日期 */}
                <p
                  className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em]"
                  style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                >
                  最新一期 · Iss. {String(count).padStart(2, '0')}
                  <span className="mx-2">·</span>
                  {daysAgo(latest.publishedAt)}
                </p>

                {/* hero 标题 */}
                <p
                  className="mb-3 text-xl font-bold leading-snug tracking-tight"
                  style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
                >
                  {latest.headline}
                </p>

                {/* 摘要 2-3 行截断 — italic 跟报刊统一 */}
                {latest.summary && (
                  <p
                    className="text-sm italic leading-relaxed line-clamp-3"
                    style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
                  >
                    {latest.summary.replace(/^\s*##?\s*/, '').slice(0, 180)}
                  </p>
                )}

                {/* 阅读箭头 small caps */}
                <p
                  className="mt-4 text-[10px] font-bold uppercase tracking-[0.28em] transition-transform duration-150 group-hover:translate-x-1"
                  style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                >
                  阅读本期 →
                </p>
              </>
            ) : (
              <p
                className="text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
              >
                尚无出刊记录
              </p>
            )}
          </div>
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
