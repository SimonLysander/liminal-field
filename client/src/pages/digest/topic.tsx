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
  // 本期 LEAD = 最新一期(reports 已按 publishedAt 倒序);其余进 archive grid
  const lead = reports[0];
  const archive = reports.slice(1);
  const totalIssues = reports.length;
  const firstIssueAt = reports[reports.length - 1]?.publishedAt;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full max-w-[1240px] px-10 py-16 max-[520px]:px-5">

        {/* ── breadcrumb ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
          className="mb-8"
        >
          <Link
            to="/digest"
            className="text-[11px] font-bold uppercase tracking-[0.28em] transition-opacity duration-150 hover:opacity-60"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            ← 返回目录
          </Link>
        </motion.div>

        {/* ── 栏目报头(masthead 占满宽) ── */}
        <motion.header
          className="mb-0"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          <p
            className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            Column · 专栏
          </p>

          <h1
            className="mb-3 text-6xl font-bold leading-[1.0] tracking-tight max-[520px]:text-4xl"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {data.name}
          </h1>

          {data.description && (
            <p
              className="mb-4 text-xl italic leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {data.description}
            </p>
          )}

          {/* 栏目元信息(节奏/源数/期数) — 不再写 Aurora,刊头已说过,透传是噪音 */}
          <p
            className="mb-6 text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
          >
            {data.cadence ?? '手动出刊'}
            {typeof data.sourceCount === 'number' && data.sourceCount > 0 && (
              <>
                <span className="mx-3">·</span>
                {data.sourceCount} 信息源
              </>
            )}
            <span className="mx-3">·</span>
            共 {totalIssues} 期
          </p>

          <div style={{ borderBottom: '3px solid var(--ink)' }} />
        </motion.header>

        {/* ── 主体:2 栏非对称(左 ⅔ Lead+Grid / 右 ⅓ Sidebar) ── */}
        <motion.div
          className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-14"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.12, ease: appleEase }}
        >
          {/* ─── 左 8/12:本期 LEAD HERO + Archive Grid ─── */}
          <div className="lg:col-span-8">
            {reports.length === 0 ? (
              <EmptyReports />
            ) : (
              <>
                {/* 本期 LEAD HERO — 占满宽,大标题 + 长摘要 */}
                {lead && (
                  <LeadHero
                    report={lead}
                    topicId={data.id}
                    issueNumber={totalIssues}
                  />
                )}

                {/* 次级标题:更早期号 */}
                {archive.length > 0 && (
                  <>
                    <p
                      className="mb-5 mt-14 text-[11px] font-bold uppercase tracking-[0.28em]"
                      style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                    >
                      往期回顾 · Archive
                    </p>
                    <div style={{ borderTop: '1px solid var(--ink)' }} />

                    {/* archive grid 2 列网格 */}
                    <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                      {archive.map((report, i) => (
                        <ArchiveCard
                          key={report.id}
                          report={report}
                          topicId={data.id}
                          issueNumber={archive.length - i}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ─── 右 4/12:Sidebar(关于本栏目) ─── */}
          <aside className="lg:col-span-4">
            <div
              className="lg:sticky lg:top-16 lg:pl-8"
              style={{ borderLeft: '1px solid var(--separator)' }}
            >
              <p
                className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
              >
                Colophon · 关于本栏目
              </p>

              {/* sidebar 只列本栏独有元信息(不写"编辑 Aurora",那是刊物层身份);
                  也不再加底部说明句子(已经在刊物层 footer 说过) */}
              <dl className="space-y-4">
                {data.cadence && (
                  <SidebarEntry label="出刊节奏" value={data.cadence} />
                )}
                {typeof data.sourceCount === 'number' && data.sourceCount > 0 && (
                  <SidebarEntry
                    label="订阅信息源"
                    value={`${data.sourceCount} 个`}
                  />
                )}
                <SidebarEntry label="总期数" value={`${totalIssues} 期`} />
                {firstIssueAt && (
                  <SidebarEntry
                    label="开刊"
                    value={formatDateShort(firstIssueAt)}
                  />
                )}
              </dl>
            </div>
          </aside>
        </motion.div>

        {/* 页尾:仅留 3px 粗黑横线收尾,不再透传"由 Aurora 自动采集整理"
            (那句是刊物层身份,刊物层 footer "PRINTED BY AURORA · SUBSCRIBED BY YOU"
            已说过;栏目层每页都重复就是噪音) */}
        <motion.footer
          className="mt-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.25, ease: appleEase }}
        >
          <div style={{ borderTop: '3px solid var(--ink)' }} />
        </motion.footer>

      </div>
    </div>
  );
}

/* ================================================================
 * LeadHero — 本期 LEAD(报纸头条 hero,大标题 + 长摘要)
 * ================================================================ */
function LeadHero({
  report,
  topicId,
  issueNumber,
}: {
  report: PublicTopicData['reports'][0];
  topicId: string;
  issueNumber: number;
}) {
  return (
    <Link
      to={`/digest/${topicId}/${report.id}`}
      className="group block"
      aria-label={`本期 · 第 ${issueNumber} 期 · ${report.headline}`}
    >
      <p
        className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        本期 · Latest Issue
        <span className="mx-3">·</span>
        Iss. {String(issueNumber).padStart(2, '0')}
        <span className="mx-3">·</span>
        {formatDateShort(report.publishedAt)}
      </p>

      <h2
        className="mb-4 text-4xl font-bold leading-[1.1] tracking-tight transition-opacity duration-150 group-hover:opacity-70 max-[520px]:text-3xl"
        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
      >
        {report.headline}
      </h2>

      {report.summary && (
        <p
          className="text-base italic leading-relaxed line-clamp-5"
          style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
        >
          {report.summary.replace(/^\s*##?\s*/, '')}
        </p>
      )}

      <p
        className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] transition-transform duration-150 group-hover:translate-x-1"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        阅读本期全文 →
      </p>
    </Link>
  );
}

/* ================================================================
 * ArchiveCard — 往期单卡片(网格内的小卡片)
 * ================================================================ */
function ArchiveCard({
  report,
  topicId,
  issueNumber,
}: {
  report: PublicTopicData['reports'][0];
  topicId: string;
  issueNumber: number;
}) {
  return (
    <Link
      to={`/digest/${topicId}/${report.id}`}
      className="group block py-6 transition-opacity duration-150 hover:opacity-70"
      style={{ borderTop: '1px solid var(--separator)' }}
      aria-label={`第 ${issueNumber} 期 · ${report.headline}`}
    >
      <p
        className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        第 {issueNumber} 期
        <span className="mx-2">·</span>
        {formatDateShort(report.publishedAt)}
      </p>

      <h3
        className="mb-2 text-lg font-bold leading-snug tracking-tight"
        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
      >
        {report.headline}
      </h3>

      {report.summary && (
        <p
          className="text-xs italic leading-relaxed line-clamp-2"
          style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
        >
          {report.summary.replace(/^\s*##?\s*/, '').slice(0, 120)}
        </p>
      )}
    </Link>
  );
}

/* ================================================================
 * SidebarEntry — sidebar 单条 label/value 行(<dt>/<dd> 语义)
 * ================================================================ */
function SidebarEntry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        className="text-[10px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        {label}
      </dt>
      <dd
        className="mt-1 text-sm leading-snug"
        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
      >
        {value}
      </dd>
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
