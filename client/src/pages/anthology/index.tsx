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

import { useEffect, useState } from 'react';
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
        {/* 封面 — 浅底 + 深色 serif 标题，精装书气质 */}
        <div
          className="flex flex-col items-center justify-center rounded-sm px-5 py-6 transition-all duration-200 ease-out group-hover:-translate-y-1"
          style={{
            aspectRatio: '2 / 3',
            background: 'var(--shelf)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)',
            border: '0.5px solid var(--separator)',
          }}
        >
          {/* 装饰线 — 与全站 pip-a 一致 */}
          <span
            className="mb-4 block h-[1.5px] w-8 rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
          />

          {/* 标题 — 居中，大号 serif */}
          <div
            className="text-center text-sm font-bold leading-snug"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}
          >
            {item.title}
          </div>

          {/* 装饰线 — 标题下对称 */}
          <span
            className="mt-4 block h-[1.5px] w-8 rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
          />
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
    <div className="flex-1 overflow-y-auto py-12">
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 返回按钮 — 与 NoteReader 同风格 */}
        <div className="mb-5">
          <Link
            to="/anthology"
            className="text-md transition-colors duration-150 hover:text-[var(--ink-faded)]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            ← 文集
          </Link>
        </div>

        {/* 文集标题 — fade+rise+blur 入场，与 NoteReader 一致 */}
        <motion.h1
          className="mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {detail.title}
        </motion.h1>

        {/* 元信息 + 装饰线 — 与 NoteReader 同结构 */}
        <motion.div
          className="mb-10"
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {detail.entries.length} 篇
          </p>
          <motion.span
            className="mt-4 block h-[2px] rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
            initial={{ width: 0 }}
            animate={{ width: 32 }}
            transition={{ duration: 0.6, delay: 0.3, ease: smoothBounce }}
          />
        </motion.div>

        {/* 描述题记 — 无斜体，与 NoteReader summary 同风格 */}
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

        {/*
         * 卷首语 — 文集容器节点自身的正文(Phase 1 新增 bodyMarkdown 字段)。
         * 设计:仅当 bodyMarkdown 非空时渲染整段(空字符串完全跳过,等价原视觉);
         * 与 NoteReader 同款 MarkdownBody + note-prose 排版,先一个"卷首"小标
         * 提示这是序章而非条目正文,跟下方目录之间留呼吸空间。
         */}
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
              <MarkdownBody markdown={detail.bodyMarkdown} contentItemId={detail.id} />
            </div>
          </motion.section>
        )}

        {/* 条目目录 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <div
            className="mb-3 text-2xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
          >
            目录
          </div>
          <ol className="flex flex-col">
            {detail.entries.map((entry, index) => {
              const date = entry.date ? new Date(entry.date) : null;
              return (
                <li key={entry.nodeId}>
                  <Link
                    // Phase 5:URL 切 ?at=&node=,跟 admin 命名一致;Phase 8 起 entry.nodeId 即子 contentItemId
                    to={`/anthology?at=${id}&node=${entry.nodeId}`}
                    className="group -mx-2 flex items-baseline gap-4 rounded-lg px-2 py-3.5 transition-colors duration-150 hover:bg-[var(--shelf)]"
                    style={{ borderBottom: '0.5px solid var(--separator)' }}
                  >
                    {/* 序号 */}
                    <span
                      className="w-6 shrink-0 text-right text-sm tabular-nums"
                      style={{ color: 'var(--ink-ghost)' }}
                    >
                      {index + 1}
                    </span>

                    {/* 标题 */}
                    <span
                      className="flex-1 text-base font-medium transition-colors duration-150 group-hover:text-[var(--ink)]"
                      style={{ color: 'var(--ink-light)' }}
                    >
                      {entry.title}
                    </span>

                    {/* 日期 */}
                    {date && (
                      <span
                        className="shrink-0 text-xs tabular-nums"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        {date.getFullYear()}/{String(date.getMonth() + 1).padStart(2, '0')}/{String(date.getDate()).padStart(2, '0')}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>

          {/* 开始阅读 — 指向第一篇条目(Phase 5:URL 同 ?at=&node=) */}
          {detail.entries.length > 0 && (
            <div className="mt-8">
              <Link
                to={`/anthology?at=${id}&node=${detail.entries[0].nodeId}`}
                className="inline-flex items-center gap-1.5 text-md font-medium transition-colors duration-150 hover:text-[var(--ink)]"
                style={{ color: 'var(--ink-faded)' }}
              >
                开始阅读
              </Link>
            </div>
          )}
        </motion.div>
      </div>
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
  const [anthologyTitle, setAnthologyTitle] = useState('');
  /** 进度信息：当前第几篇 / 共几篇 */
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 并发拉取：条目正文 + 文集详情（返回按钮标题 + 进度计算）
    void Promise.all([
      anthologyApi.getEntry(anthologyId, entryNodeId),
      anthologyApi.getPublicDetail(anthologyId),
    ]).then(([entryData, detail]) => {
      if (cancelled) return;
      setEntry(entryData);
      setAnthologyTitle(detail.title);
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
    <div className="flex-1 overflow-y-auto py-12">
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 返回按钮 — 与 NoteReader 同风格，显示文集标题(回到卷宗概览,URL ?node=<anthologyId>) */}
        <div className="mb-5">
          <Link
            to={`/anthology?node=${anthologyId}`}
            className="text-md transition-colors duration-150 hover:text-[var(--ink-faded)]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            ← {anthologyTitle || '文集'}
          </Link>
        </div>

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

        {/* 元信息 + 装饰线 — 与 NoteReader 同结构、同格式 */}
        <motion.div
          className="mb-10"
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.2, ease: smoothBounce }}
        >
          <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {displayDate && `更新于 ${displayDate.getFullYear()}/${displayDate.getMonth() + 1}/${displayDate.getDate()} · `}
            {wordCount > 1000 ? `${(wordCount / 1000).toFixed(1)}k` : wordCount} 字 · {readMin} min
            {progress && ` · 第 ${progress.current} / ${progress.total} 篇`}
          </p>
          {/* 装饰线 — pip-a 雾蓝，与 NoteReader 同参数 */}
          <motion.span
            className="mt-4 block h-[2px] rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
            initial={{ width: 0 }}
            animate={{ width: 32 }}
            transition={{ duration: 0.6, delay: 0.3, ease: smoothBounce }}
          />
        </motion.div>

        {/* 正文 — MarkdownBody 渲染，与 NoteReader 保持一致 */}
        <motion.div
          className="note-prose text-lg leading-[1.9]"
          style={{ color: 'var(--ink-light)' }}
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <MarkdownBody markdown={entry.bodyMarkdown} />
        </motion.div>

        {/* 文章收束 — 三个墨点 */}
        <div
          className="flex items-center justify-center gap-2 py-12"
          style={{ color: 'var(--ink-ghost)', opacity: 0.4 }}
        >
          <span className="text-xs">·</span>
          <span className="text-xs">·</span>
          <span className="text-xs">·</span>
        </div>

        {/* 篇章导航 — next 是主动作（full-width 卡片），prev 是次要（文字链接） */}
        <motion.div
          className="flex flex-col gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4, ease: appleEase }}
        >
          {/* 主导航：下一篇 或 回到目录（最后一篇时）Phase 5:prev/next.key→nodeId、URL ?at=&node= */}
          {entry.next ? (
            <Link
              to={`/anthology?at=${anthologyId}&node=${entry.next.nodeId}`}
              className="group flex flex-col gap-1.5 rounded-lg px-4 py-4 transition-colors duration-150 hover:bg-[var(--shelf)]"
              style={{ border: '0.5px solid var(--separator)' }}
            >
              <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>下一篇</span>
              <span
                className="text-base font-medium transition-colors duration-150 group-hover:text-[var(--ink)]"
                style={{ color: 'var(--ink-faded)' }}
              >
                {progress && `${progress.current + 1}. `}{entry.next.title}
              </span>
            </Link>
          ) : (
            <Link
              to={`/anthology?node=${anthologyId}`}
              className="group flex flex-col gap-1.5 rounded-lg px-4 py-4 transition-colors duration-150 hover:bg-[var(--shelf)]"
              style={{ border: '0.5px solid var(--separator)' }}
            >
              <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>已读完</span>
              <span
                className="text-base font-medium transition-colors duration-150 group-hover:text-[var(--ink)]"
                style={{ color: 'var(--ink-faded)' }}
              >
                回到目录
              </span>
            </Link>
          )}

          {/* 次导航：上一篇（文字链接，视觉权重低于主导航） */}
          {entry.prev && (
            <Link
              to={`/anthology?at=${anthologyId}&node=${entry.prev.nodeId}`}
              className="text-sm transition-colors duration-150 hover:text-[var(--ink-faded)]"
              style={{ color: 'var(--ink-ghost)' }}
            >
              上一篇: {progress && `${progress.current - 1}. `}{entry.prev.title}
            </Link>
          )}
        </motion.div>
      </div>
    </div>
  );
}
