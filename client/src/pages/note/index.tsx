/*
 * NotePage — Article reader with TOC and AI chat
 *
 * Reading width: max-w-[var(--layout-reading-max)] + px-10（与编辑区阅读宽度一致）。
 *
 * Scroll-to-heading technique:
 *   Headings are rendered with data-heading-id attributes by MarkdownBody.
 *   scrollToHeading() uses getBoundingClientRect() to calculate the target
 *   position relative to the scroll container (not the viewport), then calls
 *   container.scrollTo({ behavior: 'smooth' }). CSS scroll-margin-top (80px)
 *   compensates for sticky headers so headings don't hide behind them.
 *
 * TOC panel: --layout-sidebar，与结构侧栏对齐。
 *   Active heading tracked via scroll spy (passive scroll listener), with a
 *   spring-animated paddingLeft shift for the active item.
 *
 * AI chat FAB: radius-xl (12px) panel, radius-full button. Uses the
 *   ai-fab / ai-chat-panel CSS classes for midnight theme overrides.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import { smoothBounce } from '@/lib/motion';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentDetail } from '@/services/workspace';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { LoadingState } from '@/components/LoadingState';
import { BookOpen, X, Sparkles } from 'lucide-react';

/* ================================================================
 * /note      → NoteListView  已发布文章列表
 * /note/:id  → NoteReader     文章阅读器
 * ================================================================ */

export default function NotePage() {
  const [searchParams] = useSearchParams();
  const noteId = searchParams.get('doc');
  return noteId ? <NoteReader id={noteId} /> : <NoteListView />;
}

/* ---------- Empty State ---------- */

function NoteListView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <motion.div
        className="flex flex-col items-center gap-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: smoothBounce }}
      >
        <BookOpen size={32} strokeWidth={1.2} style={{ color: 'var(--ink-ghost)', opacity: 0.5 }} />
        <span
          className="text-lg font-medium"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '-0.01em' }}
        >
          选择一篇笔记开始阅读
        </span>
      </motion.div>
    </div>
  );
}

/* ---------- Article Reader ---------- */

type TocEntry = { level: number; text: string; id: string };

function NoteReader({ id }: { id: string }) {
  const navigate = useNavigate();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeToc, setActiveToc] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const tocPanelRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const data = await contentItemsApi.getById(id);
        if (!cancelled) setContent(data);
      } catch {
        if (cancelled) return;
        banner.error('文章不存在');
        navigate('/note', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  /*
   * TOC 从 API 返回的 headings 字段派生，不再查询 DOM。
   * id 格式 "heading-N" 与 MarkdownBody 注入的 data-heading-id 一致，
   * scroll spy / scrollToHeading 直接按此 id 定位 DOM 元素。
   */
  const toc = useMemo<TocEntry[]>(() => {
    if (!content?.headings) return [];
    return content.headings.map((h, i) => ({
      level: h.level,
      text: h.text,
      id: `heading-${i}`,
    }));
  }, [content]);

  /*
   * Scroll spy — 监听滚动确定当前 TOC 高亮位置。
   * 使用 getBoundingClientRect 而非 offsetTop：offsetTop 相对于 offsetParent
   * （最近 positioned 祖先），在嵌套结构中不一定是滚动容器，导致定位错乱。
   * getBoundingClientRect 始终返回视口坐标，不受 DOM 嵌套影响。
   */
  /*
   * Scroll spy 阈值：标题的 getBoundingClientRect().top 必须 <= 容器顶部 + 50px
   * 才被视为"当前激活"。50px 而非更大的值（如 120px）是为了避免紧邻的子标题
   * 同时落入阈值范围内，导致点击父标题后高亮跳到子标题。
   */
  const handleScroll = useCallback(() => {
    const container = centerRef.current;
    if (!container || toc.length === 0) return;
    const threshold = container.getBoundingClientRect().top + 50;
    const headingEls = container.querySelectorAll('[data-heading-id]');

    for (let i = headingEls.length - 1; i >= 0; i--) {
      const el = headingEls[i] as HTMLElement;
      if (el.getBoundingClientRect().top <= threshold) {
        setActiveToc(el.getAttribute('data-heading-id') || '');
        return;
      }
    }
    if (toc[0]) setActiveToc(toc[0].id);
  }, [toc]);

  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // TOC active 项变化时，自动滚到可见位置
  useEffect(() => {
    if (!activeToc || !tocPanelRef.current) return;
    const activeEl = tocPanelRef.current.querySelector(`[data-toc-id="${activeToc}"]`);
    activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeToc]);

  /**
   * 点击 TOC 条目时滚动到对应标题，并短暂高亮目标标题。
   * 高亮的意义：相邻标题（如 h2 紧接 h3）间距很小，滚动位移几乎不可感知，
   * 闪烁效果让用户确认"确实跳到了这里"。
   */
  const scrollToHeading = (headingId: string) => {
    const el = centerRef.current?.querySelector(`[data-heading-id="${headingId}"]`) as HTMLElement | null;
    if (!el || !centerRef.current) return;
    const top = el.getBoundingClientRect().top - centerRef.current.getBoundingClientRect().top + centerRef.current.scrollTop - 16;

    centerRef.current.scrollTo({ top, behavior: 'smooth' });

    // 通过 CSS class 触发高亮动画（keyframe toc-flash），不受 React style 管理干扰
    el.classList.remove('toc-highlight');
    void el.offsetWidth;
    el.classList.add('toc-highlight');
    el.addEventListener('animationend', () => el.classList.remove('toc-highlight'), { once: true });
  };

  /* 标题信息 */
  const title = content?.publishedVersion?.title ?? content?.latestVersion.title ?? '';
  const summary = content?.publishedVersion?.summary ?? '';
  const wordCount = content?.bodyMarkdown.length || 0;
  const readMin = Math.max(1, Math.ceil(wordCount / 400));

  /* 日期：统一用 updatedAt，兜底 createdAt */
  const displayDate = content?.updatedAt
    ? new Date(content.updatedAt)
    : content?.createdAt ? new Date(content.createdAt) : null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">
      {/* Center — article body */}
      <div className="flex-1 overflow-y-auto py-12" ref={centerRef}>
       <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        <div className="mb-5">
          <button
            className="text-md transition-colors duration-150 hover:text-[var(--ink-faded)]"
            style={{ color: 'var(--ink-ghost)' }}
            onClick={() => navigate('/note')}
          >
            ← 返回
          </button>
        </div>

        {/* 文章标题 — fade+rise 入场 */}
        <motion.div
          className="relative mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{
            fontFamily: 'var(--font-serif)',
            color: 'var(--ink)',
          }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {title}
        </motion.div>

        {/* 元信息行 */}
        <motion.div
          className="mb-10"
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {displayDate && `更新于 ${displayDate.getFullYear()}/${displayDate.getMonth() + 1}/${displayDate.getDate()} · `}
            {wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字 · {readMin} min
          </p>
          {/* 装饰线 — pip-a 雾蓝 */}
          <motion.span
            className="mt-4 block h-[2px] rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
            initial={{ width: 0 }}
            animate={{ width: 32 }}
            transition={{ duration: 0.6, delay: 0.3, ease: smoothBounce }}
          />
        </motion.div>

        {summary && (
          <motion.div
            className="mb-8 rounded-lg px-4 py-3 text-lg leading-relaxed"
            style={{ color: 'var(--ink-faded)', fontStyle: 'italic', background: 'var(--shelf)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.4, delay: 0.15, ease: smoothBounce }}
          >
            {summary}
          </motion.div>
        )}

        {/* Markdown 正文 — 延迟浮入 */}
        <motion.div
          className="note-prose text-lg leading-[1.9]"
          style={{ color: 'var(--ink-light)' }}
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <MarkdownBody markdown={content.bodyMarkdown} contentItemId={id} />
        </motion.div>

        {/* 文章收束 — 三个墨点，表示阅读结束 */}
        <div
          className="flex items-center justify-center gap-2 py-12"
          style={{ color: 'var(--ink-ghost)', opacity: 0.4 }}
        >
          <span className="text-xs">·</span>
          <span className="text-xs">·</span>
          <span className="text-xs">·</span>
        </div>
       </div>
      </div>

      {/* Right — TOC panel（始终预留宽度，避免内容加载后布局抖动） */}
      <div
        ref={tocPanelRef}
        className="flex shrink-0 flex-col gap-7 overflow-y-auto px-4 py-10"
        style={{ width: 'var(--layout-sidebar)' }}
      >
        {toc.length > 0 && (
          <div>
            <div
              className="mb-3 text-2xs font-semibold uppercase tracking-label"
              style={{ color: 'var(--ink-ghost)' }}
            >
              目录
            </div>
            {toc.map((item) => (
              <motion.div
                key={item.id}
                data-toc-id={item.id}
                className="cursor-pointer border-l-2 rounded-r-lg py-[5px] text-sm transition-all duration-200 hover:bg-[var(--shelf)]"
                style={{
                  color: activeToc === item.id ? 'var(--ink-light)' : 'var(--ink-faded)',
                  fontWeight: activeToc === item.id ? 500 : 400,
                  borderColor: activeToc === item.id ? 'var(--ink-light)' : 'transparent',
                  paddingLeft: `${(item.level - 1) * 8 + 10}px`,
                }}
                animate={{ paddingLeft: activeToc === item.id ? (item.level - 1) * 8 + 12 : (item.level - 1) * 8 + 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                onClick={() => scrollToHeading(item.id)}
              >
                {item.text}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* AI floating action button */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end gap-3">
        <AnimatePresence>
          {aiOpen && (
            <motion.div
              className="ai-chat-panel flex w-[340px] flex-col overflow-hidden rounded-xl"
              style={{
                maxHeight: 420,
                background: 'var(--paper)',
                boxShadow: 'var(--shadow-xl)',
              }}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: smoothBounce }}
            >
              <div className="flex items-center justify-between px-[18px] pb-3 pt-3.5">
                <span className="truncate text-md font-semibold" style={{ color: 'var(--ink)' }}>
                  {title}
                </span>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150 hover:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-ghost)' }}
                  onClick={() => setAiOpen(false)}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-[18px] pb-4 pt-2" style={{ minHeight: 140 }}>
                <div className="px-3 py-8 text-center text-md leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
                  对这篇文稿的任何想法，随时问
                </div>
              </div>
              <div className="ai-chat-input-row px-3 pb-3">
                <input
                  ref={aiInputRef}
                  type="text"
                  className="w-full rounded-full border-none px-3.5 py-2.5 text-md outline-none"
                  style={{ background: 'var(--paper-dark)', color: 'var(--ink)' }}
                  placeholder="提问..."
                  onKeyDown={(e) => e.key === 'Escape' && setAiOpen(false)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className={`ai-fab flex h-10 w-10 items-center justify-center rounded-full border-none transition-all duration-250 ${aiOpen ? 'active' : ''}`}
          style={{
            background: aiOpen ? 'var(--ink)' : 'var(--paper)',
            color: aiOpen ? 'var(--accent-contrast)' : 'var(--ink-faded)',
            boxShadow: 'var(--shadow-md)',
          }}
          onClick={() => {
            setAiOpen((v) => !v);
            if (!aiOpen) setTimeout(() => aiInputRef.current?.focus(), 100);
          }}
        >
          <Sparkles size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

