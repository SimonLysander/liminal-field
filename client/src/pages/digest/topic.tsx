/**
 * /digest/:topicId — 专栏首页（往期归档列表）。
 *
 * task #52：接真实 API，从 mock 切换到 digestPublicApi.getTopic。
 *
 * 真报纸专栏归档：巨型栏目名 + 3px 粗横线 + 期号行式列表。
 * 每期行：左期号大字 / 中标题+摘要 / 右日期+箭头。
 * 无卡片背景，无 icon，全用排版和横线区分层级。
 */
import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { digestPublicApi } from '@/services/digest-public';
import type { PublicTopicData } from '@/services/digest-public';
import { isApiError } from '@/services/request';

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

  const [data, setData] = useState<PublicTopicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topicId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- topicId 变化时需同步重置加载状态
    setLoading(true);
    setNotFound(false);
    setError(null);

    digestPublicApi
      .getTopic(topicId)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (isApiError(err, 404)) {
          setNotFound(true);
        } else {
          const msg = err instanceof Error ? err.message : '加载失败，请稍后重试';
          setError(msg);
        }
      });
  }, [topicId]);

  /* ── loading 骨架 ── */
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-16 max-[520px]:px-5">
          <div className="mb-10 h-3 w-16 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          <div className="mb-4 h-14 w-2/3 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          <div className="mb-6 h-4 w-1/3 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          <div style={{ borderBottom: '3px solid var(--shelf)' }} />
          <div className="mt-8 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── 栏目不存在 ── */
  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.28em]"
          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
        >
          栏目不存在
        </p>
      </div>
    );
  }

  /* ── 加载错误 ── */
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.28em]"
          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
        >
          {error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const { reports } = data;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 py-16 max-[520px]:px-5">

        {/* ── breadcrumb ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
          className="mb-10"
        >
          <Link
            to="/digest"
            className="text-[11px] font-bold uppercase tracking-[0.28em] transition-opacity duration-150 hover:opacity-60"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            ← 返回目录
          </Link>
        </motion.div>

        {/* ── 栏目报头 ── */}
        <motion.header
          className="mb-0"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          {/* 专栏标签行 */}
          <p
            className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            Column · 专栏
          </p>

          {/* 巨型栏目名 */}
          <h1
            className="mb-4 text-6xl font-bold leading-[1.0] tracking-tight max-[520px]:text-4xl"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {data.name}
          </h1>

          {/* italic 副标题描述 */}
          {data.description && (
            <p
              className="mb-5 text-xl italic leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {data.description}
            </p>
          )}

          {/* meta 行 small caps */}
          <p
            className="mb-6 text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            本栏目
            <span className="mx-3">·</span>
            共 {reports.length} 期
          </p>

          {/* 报头下方 3px 粗横线 */}
          <div style={{ borderBottom: '3px solid var(--ink)' }} />
        </motion.header>

        {/* ── 往期列表 ── */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.12, ease: appleEase }}
        >
          {reports.length === 0 ? (
            <EmptyReports />
          ) : (
            <div className="flex flex-col">
              {/* reports 按 publishedAt 倒序，期号取倒序位置（最新 = 最大期号） */}
              {reports.map((report, i) => (
                <IssueRow
                  key={report.id}
                  report={report}
                  topicId={data.id}
                  issueNumber={reports.length - i}
                />
              ))}
            </div>
          )}
        </motion.section>

        {/* ── 页尾 ── */}
        <motion.footer
          className="mt-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.25, ease: appleEase }}
        >
          <div style={{ borderTop: '3px solid var(--ink)' }} />
          <p
            className="mt-5 text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            由 Aurora 自动采集整理 &nbsp;·&nbsp; 欢迎订阅
          </p>
        </motion.footer>

      </div>
    </div>
  );
}

/* ================================================================
 * IssueRow — 单期行式条目（期号 / 标题+摘要 / 日期箭头三段式）
 * ================================================================ */

function IssueRow({
  report,
  topicId,
  issueNumber,
}: {
  report: PublicTopicData['reports'][0];
  topicId: string;
  issueNumber: number;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)' }}>
      <Link
        to={`/digest/${topicId}/${report.id}`}
        className="group flex items-start gap-8 py-7 transition-opacity duration-150 hover:opacity-70 max-[520px]:flex-col max-[520px]:gap-3"
        aria-label={`第 ${issueNumber} 期 · ${report.headline}`}
      >
        {/* 左：期号大字 + 日期（垂直） */}
        <div className="w-20 shrink-0 pt-0.5 max-[520px]:w-auto max-[520px]:flex max-[520px]:gap-3 max-[520px]:items-baseline">
          <p
            className="text-2xl font-bold leading-none tracking-tight"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            第{issueNumber}期
          </p>
          <p
            className="mt-2 text-[10px] font-bold uppercase tracking-[0.22em] max-[520px]:mt-0"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            {formatDateShort(report.publishedAt)}
          </p>
        </div>

        {/* 中：标题 + 摘要 */}
        <div className="min-w-0 flex-1">
          {report.headline && (
            <p
              className="mb-1.5 text-xl font-bold leading-snug tracking-tight"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {report.headline}
            </p>
          )}

          {report.summary && (
            <p
              className="text-sm italic leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {report.summary}
            </p>
          )}
        </div>

        {/* 右：阅读箭头 */}
        <div
          className="shrink-0 pt-0.5 text-base font-bold transition-transform duration-150 group-hover:translate-x-1 max-[520px]:self-end"
          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
        >
          →
        </div>
      </Link>
    </div>
  );
}

/* ================================================================
 * EmptyReports
 * ================================================================ */

function EmptyReports() {
  return (
    <div
      className="py-24 text-center"
      style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        本专栏尚无出刊记录
      </p>
    </div>
  );
}
