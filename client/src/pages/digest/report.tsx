/**
 * /digest/:topicId/:reportId — 单期报告阅读页。
 *
 * 数据来源：真实 API（task #52 接入）
 *   - GET /api/v1/digest/topics/:topicId/reports/:reportId
 *   - 返回 topic 信息、报告 markdown、findings（参考资料）、siblings（prev/next 导航）
 *
 * 版式：
 *   - 报头（标题 + 出版信息行）
 *   - MarkdownBody 渲染报告正文（AI 生成的 markdown，含 ## 章节 + [CIT N] 引用）
 *   - 参考资料列表（findings，带 [CIT N] 序号 + 来源链接）
 *   - 页尾 prev/next 导航（按 siblings publishedAt 升序排列）
 *   - 右栏：已登录 → AdvisorSidebar；未登录 → 占位
 *
 * 三态处理：loading / error（含 404）/ success
 * 注意：report.tsx 不依赖 mock-data.ts，mock 文件保留供 index.tsx / topic.tsx 使用
 */
import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { useAuthStatus } from '@/hooks/use-auth-status';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { digestPublicApi } from '@/services/digest-public';
import type { PublicReportData, PublicSibling } from '@/services/digest-public';
import { isApiError } from '@/services/request';

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 报告头部用：YYYY-MM-DD HH:MM（精确到分钟，让读者知道每期"出版"时间） */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ================================================================
 * 页面组件
 * ================================================================ */

export default function DigestReportPage() {
  const { topicId, reportId } = useParams<{ topicId: string; reportId: string }>();
  const { status: authStatus } = useAuthStatus();

  const [data, setData] = useState<PublicReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topicId || !reportId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reportId 变化时需同步重置加载状态
    setLoading(true);
    setNotFound(false);
    setError(null);

    digestPublicApi
      .getReport(topicId, reportId)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        // 404 单独处理（报告不存在 / 事项不存在）
        if (isApiError(err, 404)) {
          setNotFound(true);
        } else {
          // 公开端不跳转登录，不应有 401；其他错误展示错误态
          const msg = err instanceof Error ? err.message : '加载失败，请稍后重试';
          setError(msg);
        }
      });
  }, [topicId, reportId]);

  /* ── loading 骨架 ── */
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto py-16">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-5">
          <div className="mb-10 h-3 w-32 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          <div className="mb-4 h-12 w-3/4 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          <div className="mb-8 h-4 w-1/2 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
          {/* 固定宽度数组，避免 Math.random 产生 impure 警告 */}
          <div className="space-y-3">
            {[100, 92, 85, 97, 78, 90, 83, 95].map((w, i) => (
              <div key={i} className="h-4 animate-pulse rounded" style={{ background: 'var(--shelf)', width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── 报告不存在 ── */
  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.28em]"
          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
        >
          报告不存在
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

  const { topic, report, siblings } = data;

  /* ── prev/next 导航（siblings 已按 publishedAt 升序） ── */
  const currentIdx = siblings.findIndex((s) => s.id === reportId);
  const prevSibling: PublicSibling | null = currentIdx > 0 ? siblings[currentIdx - 1] : null;
  const nextSibling: PublicSibling | null =
    currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;

  /* 期号 = 当前在 siblings 中的位置（1-based） */
  const issueNumber = currentIdx + 1;

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">

      {/* ── 主体阅读区 ── */}
      <div className="flex-1 overflow-y-auto py-16">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-5">

          {/* breadcrumb */}
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: appleEase }}
            className="mb-10 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em]"
            style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            aria-label="面包屑"
          >
            <Link to="/digest" className="transition-opacity duration-150 hover:opacity-60">
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
            className="mb-0"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: appleEase }}
          >
            {/* 期号 + 出版信息行 */}
            <p
              className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            >
              Vol. 1 &nbsp;·&nbsp; 第 {issueNumber} 期 &nbsp;·&nbsp; {formatDateTime(report.publishedAt)} &nbsp;·&nbsp; 编辑：Aurora
            </p>

            {/* 巨型本期标题 */}
            <h1
              className="mb-4 text-6xl font-bold leading-[1.0] tracking-tight max-[520px]:text-4xl"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {report.headline}
            </h1>

            {/* 副标题：findings 数 + topic 名 */}
            <p
              className="mb-5 text-xl italic leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              {report.findings.length > 0
                ? `${report.findings.length} 条参考资料 · ${topic.name}`
                : topic.name}
            </p>

            {/* 报头下方 3px 粗黑横线 */}
            <div style={{ borderBottom: '3px solid var(--ink)' }} />
          </motion.header>

          {/* ── 报告正文（MarkdownBody） ── */}
          <motion.div
            className="mt-8"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1, ease: appleEase }}
          >
            {report.markdown ? (
              <MarkdownBody
                markdown={report.markdown}
                contentItemId={report.id}
              />
            ) : (
              <p
                className="text-base italic leading-relaxed"
                style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
              >
                （报告正文暂未生成）
              </p>
            )}
          </motion.div>

          {/* ── 参考资料（findings） ── */}
          {report.findings.length > 0 && (
            <motion.section
              className="mt-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.15, ease: appleEase }}
            >
              <div style={{ borderTop: '1px solid var(--ink)' }} />

              <p
                className="mt-6 mb-4 text-[11px] font-bold uppercase tracking-[0.28em]"
                style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
              >
                参考资料
              </p>

              <ol className="flex flex-col gap-3">
                {report.findings.map((f) => (
                  <li key={f.citationId} className="flex items-baseline gap-3">
                    {/* [CIT N] 标注 */}
                    <span
                      className="shrink-0 text-[10px] font-bold uppercase tracking-[0.22em]"
                      style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                    >
                      [{f.citationId}]
                    </span>

                    <div className="min-w-0">
                      {/* 来源名 small caps */}
                      <span
                        className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em]"
                        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                      >
                        {f.sourceName}
                      </span>

                      {/* 标题链接 */}
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm leading-snug transition-opacity duration-150 hover:opacity-60"
                        style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
                      >
                        {f.title}
                      </a>

                      {/* 发布时间 */}
                      {f.publishedAt && (
                        <span
                          className="ml-2 text-[10px] font-bold uppercase tracking-[0.16em]"
                          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                        >
                          {formatDate(f.publishedAt)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </motion.section>
          )}

          {/* ── 页尾 ── */}
          <motion.div
            className="mt-16 pb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2, ease: appleEase }}
          >
            <div style={{ borderTop: '3px solid var(--ink)' }} />

            <p
              className="mt-6 text-center text-[11px] font-bold uppercase tracking-[0.28em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
            >
              —— 本期完 ——
            </p>

            {/* prev/next 导航 */}
            {(prevSibling || nextSibling) && (
              <div className="mt-8 flex items-center justify-between gap-4">
                {prevSibling ? (
                  <Link
                    to={`/digest/${topicId}/${prevSibling.id}`}
                    className="text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
                    style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                  >
                    ← {prevSibling.headline || '上一期'}
                  </Link>
                ) : (
                  <span />
                )}
                {nextSibling ? (
                  <Link
                    to={`/digest/${topicId}/${nextSibling.id}`}
                    className="text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
                    style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                  >
                    {nextSibling.headline || '下一期'} →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </motion.div>

        </div>
      </div>

      {/* ── 右栏：Aurora 追问 ──
          三态：checking→骨架；unauthenticated→登录按钮；authenticated→真 AdvisorSidebar */}
      <motion.aside
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: appleEase }}
        className="hidden w-[220px] shrink-0 xl:flex xl:flex-col"
        style={{ paddingTop: '4rem', paddingRight: '1.5rem', paddingBottom: '2rem' }}
      >
        {authStatus === 'checking' && (
          /* loading 骨架：防止登录态未知时 UI 闪烁 */
          <div className="sticky top-16 flex flex-col gap-3">
            <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
            <div style={{ borderBottom: '1px solid var(--ink)' }} />
            <div className="h-16 animate-pulse rounded-lg" style={{ background: 'var(--shelf)' }} />
          </div>
        )}

        {authStatus === 'unauthenticated' && data && (
          <AuroraPlaceholder />
        )}

        {authStatus === 'authenticated' && data && (
          /* 已登录：接真 AdvisorSidebar，每篇报告独立对话，同栏目共享 agent 实例 */
          <div className="flex h-full flex-col">
            <AdvisorSidebar
              sessionKey={`digest-report-${reportId}`}
              agentInstanceKey={`digest-topic-${topicId}`}
              agentKey="report-analyst"
              source="report-reader"
              context={{
                document: {
                  contentItemId: reportId ?? '',
                  title: report.headline,
                  bodyMarkdown: report.markdown,
                },
              }}
              greeting="想聊哪条？"
            />
          </div>
        )}
      </motion.aside>
    </div>
  );
}

/* ================================================================
 * AuroraPlaceholder — 未登录状态的 Aurora 追问占位（纯排版，无 icon）
 * 由外层 motion.aside 控制动画，此组件只管内容。
 * ================================================================ */

function AuroraPlaceholder() {
  return (
    <div className="sticky top-16 flex flex-col gap-5">
      {/* 栏头 small caps */}
      <div>
        <p
          className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em]"
          style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
        >
          Editorial · 编辑追问
        </p>
        <div style={{ borderBottom: '1px solid var(--ink)' }} />
      </div>

      {/* 说明文字 */}
      <p
        className="text-sm leading-relaxed"
        style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
      >
        登录后可与 Aurora 追问本期，深入挖掘你感兴趣的细节。
      </p>

      {/* 登录按钮（纯文字，无 icon） */}
      <Link
        to="/login"
        className="text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        登录后追问 →
      </Link>

      {/* Aurora 署名，纯文字 */}
      <p
        className="mt-2 text-[10px] font-bold uppercase tracking-[0.22em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        Aurora
      </p>
    </div>
  );
}
