/*
 * AnthologyPage — 文集展示端，三种视图通过 URL query params 切换：
 *
 *   /anthology                    → AnthologyListView  已发布文集列表
 *   /anthology?node=<id>          → AnthologyOverview  卷宗概览(标题/描述/卷首/章节目录)
 *   /anthology?at=<id>&node=<key> → EntryReader        条目阅读(正文 + 上下篇导航)
 *
 * Phase 5(2026-05-31)路由迁移:旧 ?id=&entry= → ?at=&node=,跟 admin 命名一致
 * (at=进入的容器,node=选中的节点)。后端 prev/next 字段也从 key 改名 nodeId。
 *
 * 设计与 NoteReader 保持一致的阅读体验:serif 字体、阅读宽度 --layout-reading-max。
 * 动画沿用 smoothBounce(入场)和 appleEase(次要过渡),与全站一致。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase, smoothBounce } from '@/lib/motion';
import {
  anthologyApi,
  type AnthologyPublicListItem,
  type AnthologyPublicDetail,
  type AnthologyEntryDetail,
} from '@/services/workspace';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { MarkdownTocPanel } from '@/components/shared/MarkdownTocPanel';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/LoadingState';

/* ================================================================
 * 路由分发：根据 query params 决定渲染哪个子视图
 * ================================================================ */

export default function AnthologyPage() {
  const [searchParams] = useSearchParams();
  // at = 进入的文集容器 id;node = 选中的节点 id(文集容器自身 or 子条目)
  // 取舍:跟 admin URL(?at=&node=)统一,且消除"id"歧义(原 id 同时承担两种角色)。
  const at = searchParams.get('at');
  const node = searchParams.get('node');

  // 无 node:回根列表(无论 at 是否存在,缺 node 都没法定位卷宗)
  if (!node) return <AnthologyListView />;
  // 有 node 无 at:把 node 当卷宗容器 id 展示概览(兼容直接命中文集容器)
  if (!at) return <AnthologyOverview id={node} />;
  // 有 at 也有 node:进条目阅读;at=文集容器 id,node=条目 nodeId(= 子 contentItemId)
  return <EntryReader anthologyId={at} entryNodeId={node} />;
}

/* ================================================================
 * AnthologyListView — 文集列表
 * ================================================================ */

function AnthologyListView() {
  const [items, setItems] = useState<AnthologyPublicListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void anthologyApi.listPublished().then((data) => {
      if (!cancelled) { setItems(data); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (items.length === 0) {
    // 真·空内容 → 统一空态(空花圃土床小苗 = 待生长)
    return <EmptyState title="暂无文集" />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-10">
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 页面标题 */}
        <motion.h1
          className="mb-8 text-3xl font-bold tracking-tight"
          style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          文集
        </motion.h1>

        {/* 书架 — 精装书封面风格 */}
        <motion.div
          className="flex flex-wrap gap-7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1, ease: appleEase }}
        >
          {items.map((item, index) => (
            <BookCover key={item.id} item={item} index={index} />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

/**
 * BookCover — 精装书封面。
 *
 * 不用深色色块（电子书感太重），改为浅暖底色 + 深色 serif 标题。
 * 像高端出版社的极简封面：大面积留白、标题居中偏下、pip-a 装饰线点睛。
 * 比例 2:3（实体书），hover 微上浮 + 阴影加深。
 */
function BookCover({ item, index }: { item: AnthologyPublicListItem; index: number }) {
  const displayDate = item.updatedAt ? new Date(item.updatedAt) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: appleEase }}
      style={{ width: 130 }}
    >
      <Link
        // 点封面进入卷宗概览:URL 用 node= 承接容器 id(无 at 时按概览渲染)
        to={`/anthology?node=${item.id}`}
        className="group block"
      >
        {/* 封面 — 浅底 + 深色 serif 标题,精装书气质。
            上下 pip-a 装饰线已撤(§3.3 reader 主体一律纯墨;原"标题色条"违规) */}
        <div
          className="flex flex-col items-center justify-center rounded-sm px-5 py-6 transition-all duration-200 ease-out group-hover:-translate-y-1"
          style={{
            aspectRatio: '2 / 3',
            background: 'var(--shelf)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)',
            border: '0.5px solid var(--separator)',
          }}
        >
          {/* 标题 — 居中,大号 serif,纯墨封面唯一信号 */}
          <div
            className="text-center text-sm font-bold leading-snug"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {item.title}
          </div>
        </div>

        {/* 封面下方 meta */}
        <div className="mt-2 text-center text-xs tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
          {item.entryCount} 篇
          {displayDate && (
            <> · {displayDate.getFullYear()}/{displayDate.getMonth() + 1}/{displayDate.getDate()}</>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

/* ================================================================
 * AnthologyOverview — 文集概览（标题 + 描述 + 条目目录）
 * ================================================================ */

function AnthologyOverview({ id }: { id: string }) {
  const [detail, setDetail] = useState<AnthologyPublicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // 右栏 markdown headings TOC(仅当卷首语含标题时显示),与 EntryReader 同模式
  const centerRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string; level: number }>>([]);
  const refreshToc = useCallback(() => {
    if (!centerRef.current) return;
    const els = Array.from(
      centerRef.current.querySelectorAll('[data-heading-id]'),
    ) as HTMLElement[];
    setToc(
      els.map((el) => ({
        id: el.getAttribute('data-heading-id') || '',
        text: el.textContent || '',
        level: parseInt(el.tagName.slice(1), 10) || 1,
      })),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void anthologyApi.getPublicDetail(id).then((data) => {
      if (!cancelled) { setDetail(data); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-base" style={{ color: 'var(--ink-ghost)' }}>文集不存在</span>
      </div>
    );
  }

  return (
    /* 三栏:左 navi(全局栏 + 当前文集 sub-nav 篇章列表)/ 中 卷首语正文 / 右 卷首语 markdown headings TOC。
     *  跨篇跳转走左栏 sub-nav,中区只放正文,右栏目录是当前页正文的标题锚点(卷首语无标题则不显示)。 */
    <div className="relative flex w-full items-stretch overflow-hidden">
      <div ref={centerRef} className="flex-1 overflow-y-auto py-12">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">

        {/* 文集标题 — 左对齐,跟其他 reader 一致(扉页装饰已撤,Overview 内容够完整不需要 banner) */}
        <motion.h1
          className="mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {detail.title}
        </motion.h1>

        {/* 元信息行(纯墨;原 pip-a 雾蓝色条违规已删) */}
        <motion.p
          className="mb-10 text-xs"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          {detail.entries.length} 篇
        </motion.p>

        {/* 描述题记 — 与 NoteReader summary 同风格 */}
        {detail.description && (
          <motion.div
            className="mb-8 rounded-lg px-4 py-3 text-lg leading-relaxed"
            style={{ color: 'var(--ink-faded)', background: 'var(--shelf)' }}
            initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.4, delay: 0.15, ease: smoothBounce }}
          >
            {detail.description}
          </motion.div>
        )}

        {/* 卷首语 */}
        {detail.bodyMarkdown && (
          <motion.section
            className="my-12"
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, delay: 0.2, ease: smoothBounce }}
          >
            <div
              className="mb-4 text-2xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              卷首
            </div>
            <div
              className="note-prose text-lg leading-[1.9]"
              style={{ color: 'var(--ink-light)' }}
            >
              <MarkdownBody
                markdown={detail.bodyMarkdown}
                contentItemId={detail.id}
                onHeadingsMarked={refreshToc}
              />
            </div>
          </motion.section>
        )}

        </div>
      </div>

      {/* 右 TOC — 卷首语 markdown 标题锚点,无标题时不渲染 */}
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}

/* ================================================================
 * EntryReader — 条目阅读视图
 *
 * 布局与 NoteReader 对齐：阅读区域 max-w reading-max，正文 serif 字体。
 * 底部提供上一篇 / 下一篇导航条，由后端在 getEntry 响应中直接返回。
 * ================================================================ */

function EntryReader({ anthologyId, entryNodeId }: { anthologyId: string; entryNodeId: string }) {
  // 命名澄清:anthologyId=文集容器 contentItemId(URL ?at=);
  // entryNodeId=条目子节点 contentItemId(URL ?node=,Phase 1 后 key==nodeId)。
  const [entry, setEntry] = useState<AnthologyEntryDetail | null>(null);
  /** 进度信息：当前第几篇 / 共几篇 */
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  /** 右栏 TOC = 当前篇正文的 markdown headings(MarkdownBody 渲染后从 DOM 提取) */
  const centerRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string; level: number }>>([]);
  const refreshToc = useCallback(() => {
    if (!centerRef.current) return;
    const els = Array.from(
      centerRef.current.querySelectorAll('[data-heading-id]'),
    ) as HTMLElement[];
    setToc(
      els.map((el) => ({
        id: el.getAttribute('data-heading-id') || '',
        text: el.textContent || '',
        level: parseInt(el.tagName.slice(1), 10) || 1,
      })),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    // 并发拉取：条目正文 + 文集详情(用于进度计算)
    void Promise.all([
      anthologyApi.getEntry(anthologyId, entryNodeId),
      anthologyApi.getPublicDetail(anthologyId),
    ]).then(([entryData, detail]) => {
      if (cancelled) return;
      setEntry(entryData);
      // Phase 8 后 entries 列表统一 nodeId 字段,直接定位当前阅读位置
      const idx = detail.entries.findIndex((e) => e.nodeId === entryNodeId);
      setProgress({ current: idx + 1, total: detail.entries.length });
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [anthologyId, entryNodeId]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-base" style={{ color: 'var(--ink-ghost)' }}>条目不存在</span>
      </div>
    );
  }

  /* 日期：统一用 updatedAt，与 NoteReader 同逻辑 */
  const displayDate = entry.updatedAt ? new Date(entry.updatedAt) : null;
  /* 字数 + 阅读时间 — 与 NoteReader 完全一致的计算逻辑 */
  const wordCount = entry.bodyMarkdown.length || 0;
  const readMin = Math.max(1, Math.ceil(wordCount / 400));

  return (
    /* 三栏对齐笔记心智:左 navi(全局栏,Sidebar 已内嵌篇章子导航)/ 中 正文 / 右 TOC(当前篇正文目录)
     *  跨篇切换由左 Sidebar 完成;右 TOC = 当前篇 markdown headings 锚点,与笔记 NoteReader 一致 */
    <div className="relative flex w-full items-stretch overflow-hidden">
      {/* 中:正文 — centerRef 给右栏 MarkdownTocPanel 用于 querySelector heading + 滚动定位 */}
      <div ref={centerRef} className="flex-1 overflow-y-auto py-12">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 返回入口已统一到左 Sidebar 面包屑,中区不再放重复的「← 文集名」 */}

        {/* 条目标题 — 与 NoteReader 同规格 */}
        <motion.h1
          className="mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {entry.title}
        </motion.h1>

        {/* 元信息行(纯墨,§3.3 reader 主体一律纯墨;原 pip-a 雾蓝色条违规已删) */}
        <motion.p
          className="mb-10 text-xs"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          {displayDate && `更新于 ${displayDate.getFullYear()}/${displayDate.getMonth() + 1}/${displayDate.getDate()} · `}
          {wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字 · {readMin} min
          {progress && ` · 第 ${progress.current} / ${progress.total} 篇`}
        </motion.p>

        {/* 正文 — note-prose + MarkdownBody */}
        <motion.div
          className="note-prose text-lg leading-[1.9]"
          style={{ color: 'var(--ink-light)' }}
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <MarkdownBody markdown={entry.bodyMarkdown} onHeadingsMarked={refreshToc} />
        </motion.div>

        {/* 章末收束 — 一束勿忘我(纸艺,§3.3 合规;花语「记忆」呼应卷宗记忆主题) */}
        <div className="flex items-center justify-center py-24">
          <img
            src="/garden/chapter-end.webp"
            alt=""
            className="h-auto w-auto max-h-[60px] select-none"
            draggable={false}
          />
        </div>

        {/* 篇章导航 — 两边对称文字链接(无卡片),书页脚气质:
              prev 靠左、next 靠右,中间 justify-between 自动平衡;
              末篇 next 改「回到卷首」(去 Overview 看卷首语),语义比「目录」/「首页」更准 —
              文集没有独立的"目录页",卷首才是它的根入口。 */}
        <motion.div
          className="flex items-center justify-between gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4, ease: appleEase }}
        >
          {entry.prev ? (
            <Link
              to={`/anthology?at=${anthologyId}&node=${entry.prev.nodeId}`}
              className="min-w-0 truncate text-sm transition-colors duration-150 hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              ← 上一篇 · {entry.prev.title}
            </Link>
          ) : (
            /* 首篇:空占位撑 justify-between,让 next 自然靠右 */
            <span />
          )}
          {entry.next ? (
            <Link
              to={`/anthology?at=${anthologyId}&node=${entry.next.nodeId}`}
              className="min-w-0 truncate text-sm transition-colors duration-150 hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              下一篇 · {entry.next.title} →
            </Link>
          ) : (
            <Link
              to={`/anthology?node=${anthologyId}`}
              className="text-sm transition-colors duration-150 hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              回到卷首 →
            </Link>
          )}
        </motion.div>
      </div>
      </div>

      {/* 右 TOC — 当前篇正文的 markdown 标题锚点,跟笔记 NoteReader 一致 */}
      <MarkdownTocPanel toc={toc} centerRef={centerRef} />
    </div>
  );
}

/* MarkdownTocPanel 已抽到 components/shared/MarkdownTocPanel,与笔记共用同款 scroll spy/闪烁/渐隐 */
