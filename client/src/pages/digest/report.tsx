/**
 * /digest/:topicId/:reportId — 单期阅读页。
 *
 * 真报纸版面：
 * - 头条：整宽 + 巨型标题 + dropcap 首字放大 + 双栏正文
 * - 次条：1px 黑横线分隔 + 标题 + 双栏正文
 * - 无 MarkdownBody（改用结构化 mock 数据直接渲染）
 * - 右栏：已登录→AdvisorSidebar(report-analyst)；未登录→登录按钮；检测中→骨架
 * - 正文 paragraphs 为空时 fallback 为"简讯"layout
 */
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { useAuthStatus } from '@/hooks/use-auth-status';
import { MOCK_TOPICS, MOCK_REPORTS } from './mock-data';
import type { MockPick, MockReport } from './mock-data';

/* ================================================================
 * 工具函数
 * ================================================================ */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 把 MockReport 序列化成 Markdown，作为 AdvisorSidebar 的 context.document.bodyMarkdown。
 * 每条 pick 独立 h2 节，段落原样附上；追问时 agent 可按条目序号引用。
 */
function reportToMarkdown(report: MockReport): string {
  const lines: string[] = [];
  report.picks.forEach((pick, i) => {
    lines.push(`## ${i + 1}. ${pick.title}`);
    if (pick.subtitle) lines.push(`*${pick.subtitle}*`);
    lines.push(`来源：${pick.source}${pick.readingTime ? `  阅读：${pick.readingTime}` : ''}`);
    lines.push('');
    if (pick.paragraphs.length > 0) {
      pick.paragraphs.forEach((p) => { lines.push(p); lines.push(''); });
    } else {
      lines.push(pick.snippet);
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
  const { status: authStatus } = useAuthStatus();

  const topic = MOCK_TOPICS.find((t) => t.id === topicId);
  const report = MOCK_REPORTS.find((r) => r.id === reportId && r.topicId === topicId);

  // 同 topicId 下的所有 report，按 issueNumber 排序（用于 prev/next 导航）
  const siblingReports = report
    ? MOCK_REPORTS.filter((r) => r.topicId === topicId).sort(
        (a, b) => a.issueNumber - b.issueNumber,
      )
    : [];
  const currentIdx = siblingReports.findIndex((r) => r.id === reportId);
  const prevReport = currentIdx > 0 ? siblingReports[currentIdx - 1] : null;
  const nextReport =
    currentIdx < siblingReports.length - 1 ? siblingReports[currentIdx + 1] : null;

  if (!topic || !report) {
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

  const headline = report.headline ?? '本期精选';
  const [firstPick, ...restPicks] = report.picks;

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
              Vol. 1 &nbsp;·&nbsp; 第 {report.issueNumber} 期 &nbsp;·&nbsp; {formatDate(report.date)} &nbsp;·&nbsp; 编辑：Aurora
            </p>

            {/* 巨型本期标题 */}
            <h1
              className="mb-4 text-6xl font-bold leading-[1.0] tracking-tight max-[520px]:text-4xl"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {headline}
            </h1>

            {/* 副标题 italic */}
            <p
              className="mb-5 text-xl italic leading-snug"
              style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
            >
              共 {report.picks.length} 条精选 · 涵盖 {new Set(report.picks.map((p) => p.source)).size} 个来源
            </p>

            {/* 报头下方 3px 粗黑横线 */}
            <div style={{ borderBottom: '3px solid var(--ink)' }} />
          </motion.header>

          {/* ── 正文 picks ── */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1, ease: appleEase }}
          >
            {/* 头条：整宽 + dropcap */}
            {firstPick && (
              <LeadPick pick={firstPick} />
            )}

            {/* 次条：每条 1px 黑线分隔 */}
            {restPicks.map((pick, i) => (
              <SecondaryPick key={pick.url} pick={pick} index={i + 2} />
            ))}
          </motion.div>

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
            {(prevReport || nextReport) && (
              <div className="mt-8 flex items-center justify-between gap-4">
                {prevReport ? (
                  <Link
                    to={`/digest/${topicId}/${prevReport.id}`}
                    className="text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
                    style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                  >
                    ← 第 {prevReport.issueNumber} 期
                  </Link>
                ) : (
                  <span />
                )}
                {nextReport ? (
                  <Link
                    to={`/digest/${topicId}/${nextReport.id}`}
                    className="text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
                    style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
                  >
                    第 {nextReport.issueNumber} 期 →
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

        {authStatus === 'unauthenticated' && (
          <AuroraPlaceholder />
        )}

        {authStatus === 'authenticated' && (
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
                  title: report.headline ?? report.picks[0]?.title ?? '本期精选',
                  bodyMarkdown: reportToMarkdown(report),
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
 * LeadPick — 头条（整宽，巨型标题，双栏正文，首字放大）
 * ================================================================ */

function LeadPick({ pick }: { pick: MockPick }) {
  const hasParagraphs = pick.paragraphs.length > 0;

  return (
    <div className="mt-8">
      {/* 头条 label */}
      <p
        className="mb-3 text-[10px] font-bold uppercase tracking-[0.32em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        头条
      </p>

      {/* 巨型标题 */}
      <h2
        className="mb-3 text-5xl font-bold leading-[1.05] tracking-tight max-[520px]:text-3xl"
        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
      >
        {pick.title}
      </h2>

      {/* 副标题 italic */}
      {pick.subtitle && (
        <p
          className="mb-4 text-xl italic leading-snug"
          style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
        >
          {pick.subtitle}
        </p>
      )}

      {/* 来源行 small caps */}
      <p
        className="mb-6 text-[10px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        {pick.source}
        {pick.readingTime && (
          <>
            <span className="mx-2">·</span>
            阅读 {pick.readingTime}
          </>
        )}
        <span className="mx-2">·</span>
        <a
          href={pick.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity duration-150 hover:opacity-60"
          style={{ color: 'var(--ink-ghost)' }}
        >
          查看原文 →
        </a>
      </p>

      {hasParagraphs ? (
        /* 双栏正文 + 首字放大 dropcap */
        <div
          className="max-md:columns-1"
          style={{
            columnCount: 2,
            columnGap: '2.5rem',
            columnRule: '0.5px solid var(--ink-ghost)',
          }}
        >
          {pick.paragraphs.map((para, i) => (
            <p
              key={i}
              className={`mb-4 text-base leading-relaxed ${
                i === 0
                  ? // dropcap：首字放大浮动，中文首字同样生效
                    'first-letter:float-left first-letter:text-7xl first-letter:font-bold first-letter:leading-[0.85] first-letter:mt-1 first-letter:mr-2'
                  : ''
              }`}
              style={{
                color: 'var(--ink)',
                fontFamily: 'var(--font-serif)',
                ...(i === 0 ? { fontFamily: 'var(--font-serif)' } : {}),
              }}
            >
              {para}
            </p>
          ))}
        </div>
      ) : (
        /* fallback 简讯 */
        <BriefSnippet snippet={pick.snippet} url={pick.url} />
      )}

      {/* 头条与次条之间加粗横线 */}
      <div className="mt-8" style={{ borderBottom: '1px solid var(--ink)' }} />
    </div>
  );
}

/* ================================================================
 * SecondaryPick — 次条（1px 黑线上方分隔，标题 + 双栏正文）
 * ================================================================ */

function SecondaryPick({ pick, index }: { pick: MockPick; index: number }) {
  const hasParagraphs = pick.paragraphs.length > 0;

  return (
    <div className="mt-8">
      {/* 条目序号 label */}
      <p
        className="mb-3 text-[10px] font-bold uppercase tracking-[0.32em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        {index}
      </p>

      {/* 标题 */}
      <h2
        className="mb-2 text-3xl font-bold leading-tight tracking-tight max-[520px]:text-2xl"
        style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
      >
        {hasParagraphs ? pick.title : <><em className="font-normal not-italic text-[11px] font-bold uppercase tracking-[0.22em] mr-2" style={{ color: 'var(--ink-ghost)' }}>简讯</em>{pick.title}</>}
      </h2>

      {/* 副标题 italic */}
      {pick.subtitle && hasParagraphs && (
        <p
          className="mb-3 text-base italic leading-snug"
          style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
        >
          {pick.subtitle}
        </p>
      )}

      {/* 来源行 small caps */}
      <p
        className="mb-5 text-[10px] font-bold uppercase tracking-[0.28em]"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
      >
        {pick.source}
        {pick.readingTime && (
          <>
            <span className="mx-2">·</span>
            阅读 {pick.readingTime}
          </>
        )}
        <span className="mx-2">·</span>
        <a
          href={pick.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity duration-150 hover:opacity-60"
          style={{ color: 'var(--ink-ghost)' }}
        >
          查看原文 →
        </a>
      </p>

      {hasParagraphs ? (
        /* 双栏正文 */
        <div
          className="max-md:columns-1"
          style={{
            columnCount: 2,
            columnGap: '2.5rem',
            columnRule: '0.5px solid var(--ink-ghost)',
          }}
        >
          {pick.paragraphs.map((para, i) => (
            <p
              key={i}
              className="mb-4 text-base leading-relaxed"
              style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
            >
              {para}
            </p>
          ))}
        </div>
      ) : (
        <BriefSnippet snippet={pick.snippet} url={pick.url} />
      )}

      {/* 条目间分隔线 */}
      <div className="mt-8" style={{ borderBottom: '1px solid var(--ink)' }} />
    </div>
  );
}

/* ================================================================
 * BriefSnippet — 无完整段落时的简讯 fallback
 * ================================================================ */

function BriefSnippet({ snippet, url }: { snippet: string; url: string }) {
  return (
    <p
      className="mb-3 text-base italic leading-relaxed"
      style={{ color: 'var(--ink-faded)', fontFamily: 'var(--font-serif)' }}
    >
      {snippet}
      {' '}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="not-italic text-[10px] font-bold uppercase tracking-[0.22em] transition-opacity duration-150 hover:opacity-60"
        style={{ color: 'var(--ink-ghost)' }}
      >
        查看原文 →
      </a>
    </p>
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
