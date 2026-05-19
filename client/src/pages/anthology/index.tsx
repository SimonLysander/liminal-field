/*
 * AnthologyPage — 文集展示端，三种视图通过 URL query params 切换：
 *
 *   /anthology              → AnthologyListView  已发布文集列表
 *   /anthology?id=xxx       → AnthologyOverview  文集概览（标题 + 描述 + 条目目录）
 *   /anthology?id=xxx&entry=e001 → EntryReader   条目阅读（正文 + 上下篇导航）
 *
 * 设计与 NoteReader 保持一致的阅读体验：serif 字体、阅读宽度 --layout-reading-max。
 * 动画沿用 smoothBounce（入场）和 appleEase（次要过渡），与全站一致。
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
import { LoadingState } from '@/components/LoadingState';
import { BookOpen } from 'lucide-react';

/* ================================================================
 * 路由分发：根据 query params 决定渲染哪个子视图
 * ================================================================ */

export default function AnthologyPage() {
  const [searchParams] = useSearchParams();
  const anthologyId = searchParams.get('id');
  const entryKey = searchParams.get('entry');

  if (!anthologyId) return <AnthologyListView />;
  if (!entryKey) return <AnthologyOverview id={anthologyId} />;
  return <EntryReader id={anthologyId} entryKey={entryKey} />;
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
            暂无文集
          </span>
        </motion.div>
      </div>
    );
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

        {/* 文集列表 — 竖排，每行一个文集 */}
        <motion.ul
          className="flex flex-col divide-y"
          style={{ borderColor: 'var(--separator)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1, ease: appleEase }}
        >
          {items.map((item, index) => (
            <AnthologyListItem key={item.id} item={item} index={index} />
          ))}
        </motion.ul>
      </div>
    </div>
  );
}

/* 单个文集行 — 抽为子组件，方便独立入场动画控制 */
function AnthologyListItem({ item, index }: { item: AnthologyPublicListItem; index: number }) {
  const displayDate = item.updatedAt
    ? new Date(item.updatedAt)
    : null;

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 * index, ease: appleEase }}
    >
      <Link
        to={`/anthology?id=${item.id}`}
        className="block rounded-lg px-3 py-5 transition-colors duration-150 hover:bg-[var(--shelf)]"
      >
        {/* 标题 */}
        <div className="mb-1 text-xl font-bold" style={{ color: 'var(--ink)' }}>
          {item.title}
        </div>

        {/* 描述 */}
        {item.description && (
          <div
            className="mb-2 truncate text-sm"
            style={{ color: 'var(--ink-faded)' }}
          >
            {item.description}
          </div>
        )}

        {/* 条目数 + 更新时间 */}
        <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {item.entryCount} 篇
          {displayDate && (
            <>
              {' · 更新于 '}
              {displayDate.getFullYear()}/{displayDate.getMonth() + 1}/{displayDate.getDate()}
            </>
          )}
        </div>
      </Link>
    </motion.li>
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
    setLoading(true);
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
    <div className="flex-1 overflow-y-auto px-4 py-10">
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 面包屑：文集 → 当前文集名 */}
        <motion.div
          className="mb-8 flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          <Link
            to="/anthology"
            className="transition-colors duration-150 hover:text-[var(--ink-faded)]"
          >
            文集
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--ink-faded)' }}>{detail.title}</span>
        </motion.div>

        {/* 文集标题 — fade+rise 入场 */}
        <motion.h1
          className="mb-4 text-5xl font-bold leading-snug tracking-tight"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {detail.title}
        </motion.h1>

        {/* 装饰线 */}
        <motion.span
          className="mb-6 block h-[2px] rounded-sm"
          style={{ background: 'var(--pip-a)', opacity: 0.5 }}
          initial={{ width: 0 }}
          animate={{ width: 32 }}
          transition={{ duration: 0.6, delay: 0.2, ease: smoothBounce }}
        />

        {/* 描述 */}
        {detail.description && (
          <motion.p
            className="mb-10 text-lg leading-relaxed"
            style={{ color: 'var(--ink-faded)', fontStyle: 'italic' }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: smoothBounce }}
          >
            {detail.description}
          </motion.p>
        )}

        {/* 条目目录 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: smoothBounce }}
        >
          <div
            className="mb-4 text-2xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
          >
            目录
          </div>
          <ol className="flex flex-col divide-y" style={{ borderColor: 'var(--separator)' }}>
            {detail.entries.map((entry, index) => {
              const date = entry.date ? new Date(entry.date) : null;
              return (
                <li key={entry.key}>
                  <Link
                    to={`/anthology?id=${id}&entry=${entry.key}`}
                    className="group flex items-baseline gap-4 rounded-lg px-3 py-4 transition-colors duration-150 hover:bg-[var(--shelf)]"
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

function EntryReader({ id, entryKey }: { id: string; entryKey: string }) {
  const [entry, setEntry] = useState<AnthologyEntryDetail | null>(null);
  const [anthologyTitle, setAnthologyTitle] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // 并发拉取：条目正文 + 文集标题（面包屑展示用）
    void Promise.all([
      anthologyApi.getEntry(id, entryKey),
      anthologyApi.getPublicDetail(id),
    ]).then(([entryData, detail]) => {
      if (cancelled) return;
      setEntry(entryData);
      setAnthologyTitle(detail.title);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [id, entryKey]);

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

  const date = entry.date ? new Date(entry.date) : null;

  return (
    <div className="flex-1 overflow-y-auto py-12">
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 max-[520px]:px-4">
        {/* 面包屑：文集名 → 当前条目名 */}
        <motion.div
          className="mb-8 flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--ink-ghost)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: appleEase }}
        >
          <Link
            to={`/anthology?id=${id}`}
            className="transition-colors duration-150 hover:text-[var(--ink-faded)]"
          >
            {anthologyTitle || '文集'}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--ink-faded)' }}>{entry.title}</span>
        </motion.div>

        {/* 条目标题 */}
        <motion.h1
          className="mb-4 text-3xl font-bold leading-snug tracking-tight"
          style={{ fontFamily: 'var(--font-serif)', color: 'var(--ink)' }}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, ease: smoothBounce }}
        >
          {entry.title}
        </motion.h1>

        {/* 元信息：日期 */}
        <motion.div
          className="mb-10"
          initial={{ opacity: 0, filter: 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.4, delay: 0.15, ease: smoothBounce }}
        >
          {date && (
            <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              {date.getFullYear()}/{date.getMonth() + 1}/{date.getDate()}
            </p>
          )}
          {/* 装饰线 */}
          <motion.span
            className="mt-4 block h-[2px] rounded-sm"
            style={{ background: 'var(--pip-a)', opacity: 0.5 }}
            initial={{ width: 0 }}
            animate={{ width: 32 }}
            transition={{ duration: 0.6, delay: 0.25, ease: smoothBounce }}
          />
        </motion.div>

        {/* 正文 — MarkdownBody 渲染，与 NoteReader 保持一致 */}
        <motion.div
          className="note-prose leading-[1.9]"
          style={{ color: 'var(--ink-light)', fontSize: 'var(--text-lg)' }}
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

        {/* 上一篇 / 下一篇导航条 */}
        {(entry.prev || entry.next) && (
          <motion.div
            className="flex items-center justify-between border-t pt-8 pb-4"
            style={{ borderColor: 'var(--separator)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4, ease: appleEase }}
          >
            {/* 上一篇 — 靠左 */}
            <div className="flex-1">
              {entry.prev && (
                <Link
                  to={`/anthology?id=${id}&entry=${entry.prev.key}`}
                  className="group flex flex-col gap-1"
                >
                  <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>上一篇</span>
                  <span
                    className="text-base font-medium transition-colors duration-150 group-hover:text-[var(--ink)]"
                    style={{ color: 'var(--ink-faded)' }}
                  >
                    ← {entry.prev.title}
                  </span>
                </Link>
              )}
            </div>

            {/* 下一篇 — 靠右 */}
            <div className="flex-1 text-right">
              {entry.next && (
                <Link
                  to={`/anthology?id=${id}&entry=${entry.next.key}`}
                  className="group flex flex-col items-end gap-1"
                >
                  <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>下一篇</span>
                  <span
                    className="text-base font-medium transition-colors duration-150 group-hover:text-[var(--ink)]"
                    style={{ color: 'var(--ink-faded)' }}
                  >
                    {entry.next.title} →
                  </span>
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
