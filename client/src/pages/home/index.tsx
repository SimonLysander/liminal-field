import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { homeApi } from '@/services/workspace';
import type { HomeData } from '@/services/workspace';
import { LoadingState } from '@/components/LoadingState';
import { PaperGarden } from './PaperGarden';

/* ---------- Helpers ---------- */

/** 格式化日期：当天"今天"，其余 M/D */
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
    return '今天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 从 ISO 日期提取日和月 */
function parseDayMonth(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: `${d.getMonth() + 1}月`,
  };
}

/** 字数格式化：1000 以下直接显示，以上用 k */
function formatWordCount(count: number): string {
  if (count < 1000) return `${count} 字`;
  return `${(count / 1000).toFixed(1)}k 字`;
}

/* ---------- 动画 ---------- */

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { delay: i * 0.05, duration: 0.5, ease: appleEase },
  }),
};

/* ---------- Component ---------- */

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  /* 延迟显示 loading 态，快速加载时避免闪烁 */
  const [showLoader, setShowLoader] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setShowLoader(true); }, 200);
    homeApi
      .get()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('[Home] 加载首页数据失败:', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const notes = data?.notes ?? [];
  const galleries = data?.gallery ?? [];

  if (loading) return showLoader ? <LoadingState variant="full" /> : null;

  return (
    <div className="relative flex min-h-0 flex-1 items-stretch overflow-hidden">
      <motion.div
        className="flex-1 overflow-y-auto px-4 py-10"
        initial={{ opacity: 0, filter: 'blur(3px)' }}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.4, ease: appleEase }}
      >

      {/* ── Hero：纸艺花圃 ── */}
      <PaperGarden />

      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] pt-9">
      {/* ── 最近笔记 ── */}
      {notes.length > 0 && (
        <div className="mb-10">
          <motion.div
            className="mb-3.5 flex items-baseline justify-between"
            initial="hidden"
            animate="show"
            variants={fadeUp}
            custom={0}
          >
            <h2
              className="text-xl font-bold"
              style={{
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              最近笔记
            </h2>
            <Link
              to="/note"
              className="group text-xs transition-colors duration-150"
              style={{ color: 'var(--ink-ghost)' }}
              onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
              onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-ghost)'; }}
            >
              查看全部 <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </Link>
          </motion.div>

          <div className="flex flex-col">
            {notes.map((note, i) => {
              const { day, month } = parseDayMonth(note.updatedAt || note.createdAt);
              return (
                <motion.div
                  key={note.id}
                  custom={i + 1}
                  initial="hidden"
                  animate="show"
                  variants={fadeUp}
                >
                  <Link
                    to={`/note?doc=${note.id}`}
                    className="-mx-2 flex items-center gap-5 rounded-lg px-2 py-3.5 transition-colors duration-150"
                    style={{ borderBottom: '0.5px solid var(--separator)' }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = 'var(--shelf)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* 日历式日期 */}
                    <div
                      className="flex w-12 shrink-0 flex-col items-end"
                      style={{ paddingTop: 2 }}
                    >
                      <span
                        className="text-2xl font-bold leading-none tabular-nums"
                        style={{ color: 'var(--ink)' }}
                      >
                        {day}
                      </span>
                      <span
                        className="mt-0.5 text-2xs"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        {month}
                      </span>
                    </div>

                    {/* 标题 + 摘要 */}
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-md font-semibold"
                        style={{
                          color: 'var(--ink)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {note.title}
                      </div>
                      <div
                        className="mt-1 truncate text-sm"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        {note.summary}
                      </div>
                    </div>

                    {/* 字数 */}
                    <span
                      className="shrink-0 text-xs tabular-nums"
                      style={{ color: 'var(--ink-faded)' }}
                    >
                      {formatWordCount(note.wordCount)}
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 近期图集 ── */}
      {galleries.length > 0 && (
        <div>
          <motion.div
            className="mb-3.5 flex items-baseline justify-between"
            initial="hidden"
            animate="show"
            variants={fadeUp}
            custom={notes.length}
          >
            <h2
              className="text-xl font-bold"
              style={{
                color: 'var(--ink)',
                letterSpacing: '-0.02em',
              }}
            >
              近期图集
            </h2>
            <Link
              to="/gallery"
              className="group text-xs transition-colors duration-150"
              style={{ color: 'var(--ink-ghost)' }}
              onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
              onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-ghost)'; }}
            >
              查看全部 <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </Link>
          </motion.div>

          <div className="flex gap-3.5">
            {galleries.map((gallery, i) => (
              <motion.div
                key={gallery.id}
                style={{ width: 160, flexShrink: 0 }}
                custom={i + notes.length}
                initial="hidden"
                animate="show"
                variants={fadeUp}
              >
                <Link
                  to={`/gallery?post=${gallery.id}`}
                  className="group block overflow-hidden rounded-lg transition-transform duration-200 ease-out hover:scale-[1.03]"
                  style={{ border: '0.5px solid var(--separator)' }}
                >
                  {/* 封面：hover 微放大 */}
                  <div
                    className="overflow-hidden"
                    style={{ aspectRatio: '4/3' }}
                  >
                    {gallery.coverUrl ? (
                      <img
                        src={gallery.coverUrl}
                        alt={gallery.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className="h-full w-full"
                        style={{ background: 'var(--paper-dark)' }}
                      />
                    )}
                  </div>

                  {/* 文字 */}
                  <div className="px-2.5 py-2">
                    <div
                      className="truncate text-sm font-semibold"
                      style={{ color: 'var(--ink)' }}
                    >
                      {gallery.title}
                    </div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: 'var(--ink-ghost)' }}
                    >
                      {gallery.photoCount} 张
                      {gallery.date && ` · ${formatShortDate(gallery.date)}`}
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
      </div>

      </motion.div>
    </div>
  );
}
