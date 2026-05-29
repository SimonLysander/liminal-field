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
import { structureApi } from '@/services/structure';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { LoadingState } from '@/components/LoadingState';
import { X, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { useScrollFade } from '@/hooks/use-scroll-fade';

/* ================================================================
 * 阅读端按 URL query 分发（与 Sidebar 同源：URL 是唯一真相）：
 *   /note?doc=<id>     → NoteReader   文章阅读器（叶子文档正文）
 *   /note?topic=<id>   → FolderReader 主题着陆页（节点同质化:文件夹也有自己的正文）
 *   /note              → NoteListView 未选态邀请
 *
 * 节点同质化(2026-05-29)：每个导航节点都有自己的 ContentItem，
 * 文件夹/主题节点也可能携带正文。与管理端 FolderOverviewPanel 对齐——
 * 进入文件夹时渲染其自身正文（若有），空正文则回退到邀请空态。
 * doc 优先于 topic：同时存在时展示具体文档。
 * ================================================================ */

export default function NotePage() {
  const [searchParams] = useSearchParams();
  const noteId = searchParams.get('doc');
  const topicId = searchParams.get('topic');
  if (noteId) return <NoteReader id={noteId} />;
  if (topicId) return <FolderReader nodeId={topicId} />;
  return <NoteListView />;
}

/* ---------- Empty State ---------- */

function NoteListView() {
  // 阅读端主从布局右侧未选态:大留白区,用稍繁盛的"邀请"纸艺填充(非"待生长"空花圃)
  return (
    <EmptyState
      image="/garden/reading-invite.webp"
      title="选择一篇笔记开始阅读"
    />
  );
}

/* ---------- Folder / Topic Landing ---------- */

/**
 * FolderReader — 主题（文件夹节点）着陆页。
 *
 * 节点同质化后文件夹也有自己的 ContentItem，这里渲染其已发布正文。
 * 与管理端 FolderOverviewPanel 对齐（取正文 → MarkdownBody 渲染 → 空正文不渲染），
 * 但展示端的子项列表由 Sidebar 抽屉下钻承载，故主面板只负责呈现主题自身正文。
 *
 * 数据流：topicId →（公开的 /structure-nodes/:id/path）取末节点拿 contentItemId
 *        → notesApi.getById（不传 visibility=all，仅取已发布正文）。
 * 任一步失败或正文为空 → 回退到 NoteListView 邀请空态，不打断阅读体验。
 */
function FolderReader({ nodeId }: { nodeId: string }) {
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        // path 末节点即当前主题节点本身，从中取其 ContentItem id
        const path = await structureApi.getPathByNodeId(nodeId);
        const self = path[path.length - 1];
        const contentItemId = self?.contentItemId;
        if (!contentItemId) {
          if (!cancelled) setContent(null);
          return;
        }
        // 不传 visibility=all：展示端只读已发布正文，未发布则后端 404，按空正文处理
        const data = await contentItemsApi.getById(contentItemId);
        if (!cancelled) setContent(data);
      } catch {
        // 主题无正文 / 未发布 / 加载失败：静默降级为空态，沿用既有邀请页
        if (!cancelled) setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  // 主题自身无正文（空 body 或无 ContentItem）→ 回退到既有未选态邀请
  if (!content || !content.bodyMarkdown) {
    return <NoteListView />;
  }

  const title = content.publishedVersion?.title ?? content.latestVersion.title ?? '';

  return (
    <div className="relative flex w-full items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto py-12">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
          {/* 主题标题 — 与 NoteReader 一致的衬线大标题入场 */}
          <motion.div
            className="relative mb-10 text-5xl font-bold leading-snug tracking-tight"
            style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, ease: smoothBounce }}
          >
            {title}
          </motion.div>

          {/* Markdown 正文 — 复用 NoteReader 同款 prose 容器与 MarkdownBody 渲染 */}
          <motion.div
            className="note-prose text-lg leading-[1.9]"
            style={{ color: 'var(--ink-light)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, delay: 0.15, ease: smoothBounce }}
          >
            <MarkdownBody markdown={content.bodyMarkdown} contentItemId={content.id} />
          </motion.div>
        </div>
      </div>
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

  // 大纲列表仅可滚动时才上下渐隐(短列表不被误淡)
  const tocMask = useScrollFade(tocPanelRef, [toc.length]);

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
            // 返回上一级(通常是父页),不再写死回根列表
            onClick={() => navigate(-1)}
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
        className="hidden shrink-0 flex-col self-start px-4 md:flex"
        style={{
          width: 'var(--layout-sidebar)',
          // 离屏幕顶留距离(下移到主题按钮下方)
          marginTop: '8vh',
        }}
      >
        {toc.length > 0 && (
          <>
            {/* 标题固定不滚 */}
            <div
              className="mb-3 shrink-0 text-2xs font-semibold uppercase tracking-label"
              style={{ color: 'var(--ink-ghost)' }}
            >
              大纲
            </div>
            {/* 列表高度跟随内容、超上限才滚;左侧细线从标题下方开始、长度随内容(与编辑器大纲一致) */}
            <div
              ref={tocPanelRef}
              className="overflow-y-auto"
              style={{
                maxHeight: '61.8vh',
                borderLeft: '1px solid var(--separator)',
                // 仅可滚动时上下边缘渐隐(useScrollFade),短列表不被误淡
                maskImage: tocMask,
                WebkitMaskImage: tocMask,
              }}
            >
              {toc.map((item) => (
                <div
                  key={item.id}
                  data-toc-id={item.id}
                  className="cursor-pointer truncate rounded-lg py-[5px] pr-2 text-sm transition-colors duration-200 hover:bg-[var(--shelf)]"
                  style={{
                    // 当前阅读章节 = 长春花紫(进行中,符合 accent 纲领),其余墨灰
                    color: activeToc === item.id ? 'var(--accent)' : 'var(--ink-faded)',
                    fontWeight: activeToc === item.id ? 600 : 400,
                    paddingLeft: `${(item.level - 1) * 10 + 8}px`,
                  }}
                  onClick={() => scrollToHeading(item.id)}
                >
                  {item.text}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* AI floating action button */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end gap-3">
        <AnimatePresence>
          {aiOpen && (
            <motion.div
              className="ai-chat-panel flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl"
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

