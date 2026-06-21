/**
 * /digest/:topicId/:reportId — 单期报告阅读页。
 *
 * 数据来源：真实 API（task #52 接入）
 *   - GET /api/v1/digest/topics/:topicId/reports/:reportId
 *   - 返回 topic 信息、报告 markdown、findings（参考资料）、siblings（prev/next 导航）
 *
 * 版式：
 *   - 报头（标题 + 出版信息行）
 *   - MarkdownBody 渲染报告正文（AI 生成的 markdown，含 ## 章节 + citation 引用）
 *   - 页尾 prev/next 导航（按 siblings publishedAt 升序排列）
 *   - 右栏：已登录 → AdvisorSidebar；未登录 → 占位
 *
 * 三态处理：loading / error（含 404）/ success
 * 注意：report.tsx 不依赖 mock-data.ts，mock 文件保留供 index.tsx / topic.tsx 使用
 *
 * Citation 渲染（重构）：
 *   正文预处理将 [@#CIT N] / [CIT N]（兼容老格式）替换为标准 markdown link：
 *   [N](目标URL#cit-N "title — sourceName")
 *   - href 指向真实外部 URL（新标签打开），#cit-N fragment 仅供 CSS 角标选择器命中
 *   - title 属性提供浏览器原生 hover tooltip（title — sourceName）
 *   - CSS `.digest-report-body a[href*="#cit-"]` 渲染为 superscript 角标样式（紫色）
 *   - click 委托强制 window.open(_blank) 确保跨源链接在新标签打开
 *   - 不再展示底部「参考资料」section
 */
import { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Sun, Moon } from 'lucide-react';
import { appleEase } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { useAuthStatus } from '@/hooks/use-auth-status';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { digestPublicApi } from '@/services/digest-public';
import type { PublicReportData, PublicSibling } from '@/services/digest-public';
import { isApiError } from '@/services/request';

/** 从 markdown 抽 ## 章节标题列表,作为 Aurora 的目录索引 */
function extractSections(md: string): string[] {
  return Array.from(md.matchAll(/^##\s+(.+)$/gm)).map((m) => m[1].trim());
}

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
  const { theme, setTheme } = useTheme();

  const [data, setData] = useState<PublicReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Aurora 抽屉开关 — 右上按钮 / 报告末尾入口 / ⌘+K 三处触发 */
  const [isAuroraOpen, setIsAuroraOpen] = useState(false);

  // 全局键盘监听: ⌘+K(mac) / Ctrl+K(win) 切换 Aurora
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsAuroraOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setIsAuroraOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  /**
   * 预处理正文 markdown：
   * 1. 截断参考资料分隔符之后的内容（老报告 markdown 末尾可能有，新报告后端不再追加）
   * 2. 构建 findings 字典（citationId → finding）
   * 3. 兼容 [@#CIT N]（新格式）和 [CIT N]（老格式），替换为带 title 的 markdown link：
   *    [N](目标URL#cit-N "title — sourceName")
   *    - href 是真实外部 URL，#cit-N fragment 供 CSS `.digest-report-body a[href*="#cit-"]` 选择器命中
   *    - title 属性提供浏览器原生 hover tooltip
   *    - 找不到对应 finding 的引用直接擦掉（避免渲染坏数据）
   */
  // React Compiler 管控此 memo，dep 数组由 RC 自动优化；传 [data] 是语义保底
  const processedMarkdown = useMemo(() => {
    const md = data?.report.markdown;
    if (!md) return '';

    // 截断老报告末尾的参考资料 section（新报告后端不再追加，防御性处理）
    const refSeparator = '\n---\n\n## 参考资料';
    const idx = md.indexOf(refSeparator);
    const body = idx >= 0 ? md.slice(0, idx) : md;

    // 构建 citationId → finding 映射（用于 hover title）
    const findingsMap = new Map(
      data?.report.findings?.map((f) => [f.citationId, f]) ?? [],
    );

    // [@#CIT N] / [CIT N] → [N](url#cit-N "title — sourceName")
    return body.replace(/\[(?:@#)?CIT\s+(\d+)\]/g, (_m, nStr: string) => {
      const n = parseInt(nStr, 10);
      const f = findingsMap.get(n);
      if (!f) return ''; // 找不到对应 finding 直接擦掉
      // title 转义：去掉双引号和反斜杠，防止 markdown link title 解析错位
      const safeTitle = `${f.title} — ${f.sourceName}`.replace(/[\\"]/g, '');
      return `[${n}](${f.url}#cit-${n} "${safeTitle}")`;
    });
  }, [data]);

  /**
   * 委托监听 citation 角标点击，强制在新标签打开目标网页。
   * href 形如 "https://example.com/article#cit-N"：URL 指向外部资源，#cit-N fragment 仅供 CSS 选择。
   * Plate LinkPlugin 可能拦截 link 点击，用 document 委托在冒泡阶段统一处理，确保跨源链接
   * 不会在当前页内导航。
   */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      // 只处理包含 #cit- fragment 的 citation 链接
      if (!href?.includes('#cit-')) return;
      e.preventDefault();
      // 强制在新标签打开，防止 Plate 内部路由拦截
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  /* ── loading 骨架 ── */
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto py-16">
        <div className="mx-auto w-full max-w-[55rem] px-10 max-[520px]:px-5">
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

  // Notion 签名缓动: 短促 ease-out, 开头快收尾慢, 给人"轻轻拉出"的感觉
  const notionEase: [number, number, number, number] = [0.32, 0.72, 0, 1];
  const panelDuration = 0.24;

  return (
    <div className="relative h-full w-full overflow-hidden">

      {/* 全局 fixed 主题按钮: 屏幕右上 right:12 → Aurora 打开时 right:452(440 panel + 12 边距)
          Topbar 在此路由已 return null, 这里独立渲染避免冲突 */}
      <motion.button
        type="button"
        animate={{ right: isAuroraOpen ? 452 : 12 }}
        transition={{ duration: panelDuration, ease: notionEase }}
        onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}
        className="fixed top-3 z-50 flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-[var(--hover-overlay)]"
        style={{ color: 'var(--ink-faded)' }}
        aria-label="切换主题"
      >
        <Sun size={14} strokeWidth={1.5} className="theme-icon-light" />
        <Moon size={14} strokeWidth={1.5} className="theme-icon-dark" />
      </motion.button>

      {/* ── 主体阅读区(width 动画跟着收缩, 让 mx-auto 正文居中在新可视区,
              视觉对称。Notion ease-out 240ms, 长文 reflow 实测平滑) ── */}
      <motion.div
        className="h-full overflow-y-auto"
        animate={{ width: isAuroraOpen ? 'calc(100% - 440px)' : '100%' }}
        transition={{ duration: panelDuration, ease: notionEase }}
        style={{ paddingTop: '4rem', paddingBottom: '4rem' }}
      >
        <div className="mx-auto w-full max-w-[55rem] px-10 max-[520px]:px-5">

          {/* breadcrumb + Aurora 右上按钮 一行 */}
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: appleEase }}
            className="mb-10 flex items-center justify-between"
            aria-label="面包屑"
          >
            <div
              className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em]"
              style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}
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
            </div>

            {/* breadcrumb 行右边只剩 Aurora 按钮(主题按钮是全局 fixed, 在屏幕右上, Aurora 打开时自动向左挪) */}
            {!isAuroraOpen && (
              <button
                type="button"
                onClick={() => setIsAuroraOpen(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] italic transition-all duration-150 hover:opacity-100"
                style={{
                  color: 'var(--ink-soft)',
                  border: '0.5px solid var(--separator)',
                  fontFamily:
                    '"Source Han Serif SC","Noto Serif SC","Songti SC","Iowan Old Style",Georgia,serif',
                  opacity: 0.85,
                  marginRight: '3rem',
                }}
                title="问 Aurora (⌘K)"
              >
                <Sparkles size={11} strokeWidth={1.5} />
                <span>Aurora</span>
              </button>
            )}
          </motion.nav>

          {/* ── 报头（Stratechery 现代严肃 newsletter 风）── */}
          <motion.header
            className="mb-0"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: appleEase }}
            style={{
              fontFamily:
                '"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun","Source Serif Pro","Iowan Old Style",Charter,Georgia,serif',
            }}
          >
            {/* Kicker: AI · VOL. 1 · 第 X 期 — small caps + tracking-widest */}
            <p
              className="mb-6 text-[11px] font-semibold uppercase tracking-[0.32em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {topic.name} &nbsp;·&nbsp; VOL.&nbsp;1 &nbsp;·&nbsp; ISSUE&nbsp;{issueNumber.toString().padStart(2, '0')}
            </p>

            {/* 本期标题（稍克制, 不要 6xl 那么夸张） */}
            <h1
              className="mb-5 text-5xl font-bold leading-[1.1] tracking-tight max-[520px]:text-4xl"
              style={{ color: 'var(--ink)' }}
            >
              {report.headline}
            </h1>

            {/* 出版信息: italic, 现代 newsletter 那种克制副信息 */}
            <p
              className="mb-8 text-sm italic"
              style={{ color: 'var(--ink-faded)' }}
            >
              {formatDateTime(report.publishedAt)} &nbsp;·&nbsp; 编辑 Aurora &nbsp;·&nbsp; 本期 {report.findings.length} 条参考
            </p>

            {/* 报头下方 hairline 分隔(0.5px, 不再 3px 粗黑横线那么 heavy) */}
            <div style={{ borderBottom: '0.5px solid var(--separator)' }} />
          </motion.header>

          {/* ── 报告正文（MarkdownBody）──
              digest-report-body：配合 index.css 中 citation 角标 CSS 规则，
              将正文内的 a[href*="#cit-"] 渲染为 superscript 小数字（紫色角标） */}
          <motion.div
            className="digest-report-body mt-8"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1, ease: appleEase }}
          >
            {processedMarkdown ? (
              <MarkdownBody
                markdown={processedMarkdown}
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

          {/* ── 页尾(克制 hairline, 不要 3px 粗黑) ── */}
          <motion.div
            className="mt-20 pb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2, ease: appleEase }}
            style={{
              fontFamily:
                '"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun","Source Serif Pro","Iowan Old Style",Charter,Georgia,serif',
            }}
          >
            <div style={{ borderTop: '0.5px solid var(--separator)' }} />

            <p
              className="mt-8 text-center text-[11px] font-semibold uppercase tracking-[0.32em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              本&nbsp;期&nbsp;完
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

            {/* 末尾 italic 入口: 阅读完想综合讨论时给的柔和钩子(不是按钮) */}
            {!isAuroraOpen && (
              <p
                className="mt-10 text-center text-xs italic"
                style={{ color: 'var(--ink-ghost)' }}
              >
                还想问 Aurora?{' '}
                <button
                  type="button"
                  onClick={() => setIsAuroraOpen(true)}
                  className="underline decoration-dotted underline-offset-2 transition-opacity duration-150 hover:opacity-60"
                  style={{ color: 'var(--ink-soft)' }}
                >
                  提个问题 ✦
                </button>
                {' '}&nbsp;·&nbsp; 或按{' '}
                <kbd
                  className="rounded px-1.5 py-0.5 text-[10px] not-italic"
                  style={{ background: 'var(--shelf)', border: '0.5px solid var(--separator)' }}
                >
                  ⌘ K
                </kbd>
              </p>
            )}
          </motion.div>

        </div>
      </motion.div>

      {/* ── Aurora 抽屉(Notion 风: absolute 浮右, 纯 translateX, 不带 opacity 配合) ──
          三态：checking→骨架；unauthenticated→登录提示；authenticated→真 AdvisorSidebar */}
      <AnimatePresence>
        {isAuroraOpen && (
          <motion.aside
            key="aurora-panel"
            initial={{ x: 440 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ duration: panelDuration, ease: notionEase }}
            // fixed 钉屏幕右边缘 — 无视 PublicLayout 左 sidebar 边界
            // initial/exit 用精确 440px 而不是 '100%' — 避免 motion 库 measure
            // 元素百分比时引起的 layout 微抖动(user 报告"向上移动一些")
            className="fixed bottom-0 right-0 top-0 z-40 w-[440px] overflow-hidden pt-12"
            style={{
              borderLeft: '1px solid var(--separator)',
              background: 'var(--paper-white)',
            }}
          >
            {/* 关闭按钮(左上角) — 右上角已被全局主题切换 icon + AdvisorSidebar
                的"新会话"按钮占据,叠在一起,所以挪到 panel 左上 */}
            <button
              type="button"
              onClick={() => setIsAuroraOpen(false)}
              className="absolute left-3 top-3 z-10 rounded-full p-1.5 transition-colors duration-150 hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-soft)' }}
              title="关闭 (Esc)"
              aria-label="关闭 Aurora"
            >
              <X size={16} strokeWidth={1.75} />
            </button>

            {authStatus === 'checking' && (
              <div className="flex flex-col gap-3 px-6 pt-16">
                <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
                <div className="h-16 animate-pulse rounded-lg" style={{ background: 'var(--shelf)' }} />
              </div>
            )}

            {authStatus === 'unauthenticated' && (
              <div className="px-6 pt-12">
                <AuroraPlaceholder />
              </div>
            )}

            {authStatus === 'authenticated' && (
              <div className="flex h-full flex-col">
                <AdvisorSidebar
                  sessionKey={`digest-report-${reportId}`}
                  agentInstanceKey={`digest-topic-${topicId}`}
                  agentKey="report-analyst"
                  source="report-reader"
                  context={{
                    digestReport: {
                      reportId: report.id,
                      topicId: topic.id,
                      topicName: topic.name,
                      topicPrompt: topic.description,
                      headline: report.headline,
                      publishedAt: report.publishedAt,
                      sections: extractSections(report.markdown),
                      findings: report.findings.map((f) => ({
                        citationId: f.citationId,
                        title: f.title,
                        sourceName: f.sourceName,
                        url: f.url,
                      })),
                    },
                  }}
                  greeting="想聊哪条？"
                />
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
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
