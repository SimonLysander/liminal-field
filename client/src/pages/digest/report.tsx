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
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import type { ChatSelectionAttachment } from '@/pages/admin/lib/live-chat-selection';
import { appleEase } from '@/lib/motion';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { useAuthStatus } from '@/hooks/use-auth-status';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { digestPublicApi } from '@/services/digest-public';
import type { PublicReportData, PublicSibling } from '@/services/digest-public';
import { isApiError } from '@/services/request';
import { MarginColumn } from './MarginColumn';

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

  const [data, setData] = useState<PublicReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Aurora 抽屉开关 — 右上按钮 / 报告末尾入口 / ⌘+K 三处触发 */
  const [isAuroraOpen, setIsAuroraOpen] = useState(false);
  /** 划词工具条状态: 选中文本 + 浮窗位置(top/left, viewport 坐标) */
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  /**
   * 已"追问"过的引用 chip 列表 —— 跟编辑器"添加到聊天"是同一套机制(ChatSelectionAttachment)。
   * 用户心智里就是"把这段加到对话上下文里"这件事:报告页选区 ←→ 编辑器选区,UI/数据流统一。
   * 报告页是静态 markdown 渲染(非 Plate editor),所以 anchor/highlight/dispose 用 noop stub,
   * 只保留 id/preview/getText —— sidebar 拼 markdown 引用块进 user text 时只读这些。
   */
  const [chatSelections, setChatSelections] = useState<ChatSelectionAttachment[]>([]);
  /** 主文滚动容器 ref:scroll spy 计算"哪一节正在视口里" + 章节跳转用 */
  const mainScrollRef = useRef<HTMLDivElement>(null);
  /** scroll spy 命中的当前章节 idx,传给 MarginColumn 高亮 */
  const [activeSection, setActiveSection] = useState(0);

  // 全局键盘监听: ⌘+K(mac) / Ctrl+K(win) 切换 Aurora
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsAuroraOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setIsAuroraOpen(false);
        setSelection(null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /**
   * 划词检测: mouseup 后看是否选中了 .digest-report-body 内的正文,
   * 是则在选中区上方弹工具条(fixed 浮窗,跟随 viewport 滚动)。
   *
   * 用 fixed 浮窗是 web 平台标准做法(divider tooltip / popover 类 UI),
   * 不算"布局元素的绝对定位", 不破坏页面 layout 可预测性。
   */
  useEffect(() => {
    function handleMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 2 || text.length > 800) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const reportBody =
        (container.nodeType === Node.ELEMENT_NODE
          ? (container as Element)
          : container.parentElement
        )?.closest('.digest-report-body');
      if (!reportBody) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({
        text,
        top: rect.top - 40,
        left: rect.left + rect.width / 2,
      });
    }
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
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

  /**
   * Scroll spy:在主文滚动容器里监听滚动,根据每个 <h2> 距容器顶的位置算"当前是哪一节"。
   * 算法 = 从下往上找第一个 top <= threshold 的 heading;阈值取容器 top + 100 给点提前量
   * (用户还没"到"那一节也算开始读它,体验更自然)。
   *
   * 依赖 [data]:必须在 data 加载完(主体 DOM 渲染好)后才能拿到 container 和 headings——
   * loading 早期 return 时连主体 div 都没渲染,空依赖会让 effect 一次跑空就再也不重绑,
   * 之前 scroll spy 失灵就是栽在这。
   */
  useEffect(() => {
    if (!data) return;
    const container = mainScrollRef.current;
    if (!container) return;
    const handler = () => {
      const headings = container.querySelectorAll('h2');
      if (headings.length === 0) {
        setActiveSection(0);
        return;
      }
      const threshold = container.getBoundingClientRect().top + 100;
      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].getBoundingClientRect().top <= threshold) {
          setActiveSection(i);
          return;
        }
      }
      setActiveSection(0);
    };
    handler(); // 初始一次
    container.addEventListener('scroll', handler, { passive: true });
    return () => container.removeEventListener('scroll', handler);
  }, [data]);

  /** §N 跳转:主文容器内滚到第 idx 个 <h2>,留 40px 顶距以便看到上方 ✦ 装饰 */
  const scrollToSection = useCallback((idx: number) => {
    const container = mainScrollRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h2');
    const target = headings[idx];
    if (!target) return;
    const offset =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      40;
    container.scrollTo({ top: offset, behavior: 'smooth' });
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

  /**
   * "追问 Aurora" = 把选中文字推进 chatSelections,作为输入框上方的引用 chip。
   * 跟编辑器"添加到聊天"完全同一套机制;chip 发送瞬间被拼成 markdown 引用块进 user text。
   * 报告页没有 live editor range,anchor/highlight/dispose 都是 noop stub。
   */
  function handleAskAboutSelection() {
    if (!selection) return;
    const text = selection.text;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `report-sel-${Date.now()}`;
    const attachment: ChatSelectionAttachment = {
      id,
      preview: text.slice(0, 40),
      getText: () => text,
      getAnchor: () => ({ type: 'none' }),
      highlight: () => false,
      clearHighlight: () => {},
      dispose: () => {},
    };
    setChatSelections((prev) => [...prev, attachment]);
    setIsAuroraOpen(true);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 划词工具条 — fixed 浮窗(标准 tooltip 模式, 跟随选中区位置), 关闭后消失 */}
      {selection && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-full px-1.5 py-1"
          style={{
            top: selection.top,
            left: selection.left,
            transform: 'translateX(-50%)',
            background: 'var(--paper-white)',
            border: '0.5px solid var(--separator)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <button
            type="button"
            onClick={handleAskAboutSelection}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] italic transition-colors hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-soft)' }}
          >
            <Sparkles size={11} strokeWidth={1.5} />
            <span>追问 Aurora</span>
          </button>
        </div>
      )}


      {/* ── 主体阅读区 — flex-1 自动适应 panel 宽度变化 ── */}
      <div
        ref={mainScrollRef}
        className="flex-1 overflow-y-auto"
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

            {/* 右上 Aurora 按钮已删:右栏永远有内容(margin notes 或 Aurora),
                "打开 Aurora"语义不是"展开右栏"而是"切换右栏内容"——入口移到
                MarginColumn 底部的"叫 Aurora ✦"按钮 + ⌘K 快捷键 + 文末软入口。
                右上孤悬胶囊按钮会跟面包屑形成视觉冲突,删后顶栏更干净。 */}
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
            {/* Kicker(眉题): topic.name · VOL · ISSUE — 报纸眉题位置,小帽签 */}
            <p
              className="mb-7 text-[11px] font-semibold uppercase tracking-[0.3em]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {topic.name} &nbsp;·&nbsp; VOL.&nbsp;1 &nbsp;·&nbsp; ISSUE&nbsp;{issueNumber.toString().padStart(2, '0')}
            </p>

            {/* Headline(主标题): 本期标题,版面视觉锚点 */}
            <h1
              className="mb-7 text-5xl font-bold leading-[1.05] tracking-tight max-[520px]:text-4xl"
              style={{ color: 'var(--ink)' }}
            >
              {report.headline}
            </h1>

            {/* 这里原来渲染 topic.description 当 deck — 但 topic.description 是
                "栏目宗旨"(整个栏目讲什么),不该在单期报告页透传(那是栏目层身份)。
                本期 deck 应该是"本期讲什么"的概要,目前由正文第一段自然承担,
                不在报头单独渲染。栏目宗旨只在 /digest 列表 + /digest/:topicId 出现。 */}

            {/* Byline(署名): italic + tracking,报纸经典署名样式 */}
            <p
              className="mb-5 text-xs italic"
              style={{ color: 'var(--ink-faded)', letterSpacing: '0.04em' }}
            >
              编辑 Aurora &nbsp;·&nbsp; {formatDateTime(report.publishedAt)} &nbsp;·&nbsp; 本期 {report.findings.length} 条参考
            </p>

            {/* Double rule(报头下分隔): 粗细两条线一组——严肃日报报头下方的标准
                印刷做法,用"粗+细"对告诉读者"以上是报头,以下是正文"。比单一 hairline
                的层级感强 N 倍。 */}
            <div aria-hidden>
              <div style={{ borderTop: '1.5px solid var(--ink-soft)' }} />
              <div style={{ borderTop: '0.5px solid var(--ink-soft)', marginTop: '3px' }} />
            </div>
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

            {/* 文末 Aurora 入口已删:margin 列顶部已有"叫 Aurora"软入口
                + ⌘K 快捷键,文末再来一个就是重复 affordance,克制不重复。 */}
          </motion.div>

        </div>
      </div>

      {/* ── 右栏:MarginColumn(关) ↔ AdvisorSidebar(开)互斥 ──
          两者本质都是"辅助阅读",同时存在会让主文被挤成细条。互斥共用同一栏位:
          关 = margin 旁注(288px,章节进度 + findings 索引);开 = Aurora(440px)。
          切换走 CSS width transition,内容用 conditional render(内容里没有"两栏并存"问题,
          所以不需要 fade)。Aurora 关时仍保留 borderLeft,因为永远有内容,边线是栏之间的真实分隔。 */}
      <aside
        className="shrink-0 overflow-hidden"
        style={{
          width: isAuroraOpen ? '440px' : '288px',
          transition: 'width 240ms cubic-bezier(0.32, 0.72, 0, 1)',
          borderLeft: '1px solid var(--separator)',
        }}
      >
        <div
          className="h-full"
          style={{
            width: isAuroraOpen ? 440 : 288,
            background: 'var(--paper-white)',
          }}
        >
          {isAuroraOpen ? (
            <>
              {authStatus === 'checking' && (
                <div className="flex flex-col gap-3 px-6 pt-6">
                  <div className="h-3 w-24 animate-pulse rounded" style={{ background: 'var(--shelf)' }} />
                  <div className="h-16 animate-pulse rounded-lg" style={{ background: 'var(--shelf)' }} />
                </div>
              )}

              {authStatus === 'unauthenticated' && (
                <div className="px-6 pt-6">
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
                        // 全篇注入:报告 markdown 完整全文 + findings 完整字段(含 reason/snippet)
                        // 一并传给 sub-agent context,后端拼进 <digest_report> system 段
                        markdown: report.markdown,
                        sections: extractSections(report.markdown),
                        findings: report.findings.map((f) => ({
                          citationId: f.citationId,
                          title: f.title,
                          sourceName: f.sourceName,
                          url: f.url,
                          reason: f.reason,
                          snippet: f.snippet,
                        })),
                        // 订阅源,sub-agent browse 工具用
                        sources: topic.sources ?? [],
                      },
                    }}
                    selectionAttachments={chatSelections}
                    onRemoveSelectionAttachment={(id) =>
                      setChatSelections((prev) => prev.filter((c) => c.id !== id))
                    }
                    onClearSelectedText={() => setChatSelections([])}
                    greeting="想聊哪条？"
                    onClose={() => setIsAuroraOpen(false)}
                  />
                </div>
              )}
            </>
          ) : (
            <MarginColumn
              sections={extractSections(report.markdown)}
              findings={report.findings}
              activeSection={activeSection}
              onScrollToSection={scrollToSection}
              onAskAurora={() => setIsAuroraOpen(true)}
            />
          )}
        </div>
      </aside>
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
