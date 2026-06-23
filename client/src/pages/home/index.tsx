import { useEffect, useRef, useState } from 'react';
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

/* ---------- Manifesto — 打字效果引言 ---------- */

const MANIFESTO = '让纸墨见证我斑驳而卑微的期许，如何像云雾升腾一般，生长为生机勃勃、斩钉截铁的现实';
/** 页面加载后延迟多久开始打字（等 PaperGarden 入场完成） */
const TYPE_DELAY = 800;

/** 根据当前字符计算下一次击键间隔，模拟真人节奏 */
function getTypeInterval(char: string): number {
  // 标点停顿更久（思考感）
  if ('，、。；：' .includes(char)) return 260 + Math.random() * 120;
  // 普通字符：基础 70ms + 随机抖动 ±30ms
  return 70 + Math.random() * 60;
}

function Manifesto() {
  const [displayLen, setDisplayLen] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      let i = 0;
      const tick = () => {
        i++;
        setDisplayLen(i);
        if (i < MANIFESTO.length) {
          timerRef.current = setTimeout(tick, getTypeInterval(MANIFESTO[i - 1]));
        }
      };
      tick();
    }, TYPE_DELAY);
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-10 pt-6 pb-2 max-[520px]:px-4">
      <p
        className="text-center text-sm leading-relaxed"
        style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-reading)', minHeight: '1.5em' }}
      >
        {MANIFESTO.slice(0, displayLen)}
        {/* 光标：打字进行中闪烁，完成后淡出 */}
        {displayLen < MANIFESTO.length ? (
          <span
            className="inline-block w-[2px] align-middle"
            style={{
              height: '1em',
              background: 'var(--ink-ghost)',
              marginLeft: 1,
              animation: 'cursor-blink 0.8s steps(2) infinite',
            }}
          />
        ) : (
          <motion.span
            className="inline-block w-[2px] align-middle"
            style={{ height: '1em', background: 'var(--ink-ghost)', marginLeft: 1 }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.5, delay: 0.5 }}
          />
        )}
      </p>
    </div>
  );
}

/* ---------- 区块标题(标题 + 查看全部) ---------- */

function SectionHeader({ title, to, index }: { title: string; to: string; index: number }) {
  return (
    <motion.div
      className="mb-4 flex items-baseline justify-between"
      initial="hidden"
      animate="show"
      variants={fadeUp}
      custom={index}
    >
      <h2 className="text-base font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      <Link
        to={to}
        className="group text-xs transition-colors duration-150"
        style={{ color: 'var(--ink-ghost)' }}
        onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
        onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-ghost)'; }}
      >
        查看全部 <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
      </Link>
    </motion.div>
  );
}

/* ---------- 紧凑行(标题 + 右侧次要信息),笔记/文集/简报次条共用 ----------
 * 全部去框、flush-left,靠 hover 底色和统一行高建立秩序(不靠边框)。 */

function CompactRow({ to, title, meta }: { to: string; title: string; meta: string }) {
  return (
    <Link
      to={to}
      className="-mx-2 flex items-baseline justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-150"
      onMouseOver={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span className="truncate text-md" style={{ color: 'var(--ink)' }}>
        {title}
      </span>
      <span className="shrink-0 text-2xs tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
        {meta}
      </span>
    </Link>
  );
}

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

  const notes = (data?.notes ?? []).slice(0, 5);
  const digest = data?.digest ?? [];
  const anthology = (data?.anthology ?? []).slice(0, 4);
  const galleries = (data?.gallery ?? []).slice(0, 6);
  const feature = digest[0];

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

      {/* ── 引言：打字效果，PaperGarden 和内容之间的定调 ── */}
      <Manifesto />

      {/* 编辑部版式:① 最新简报通栏头版特稿(无框,报刊风)→ ② 下方非对称两栏
          (最近笔记主列 + 文集/图集右栏)。破掉 2×2 四方格,全部 flush-left 对齐,
          靠统一留白与行高建立秩序,不靠边框。 */}
      <div className="mx-auto w-full max-w-[var(--layout-reading-max)] px-6 pt-12 pb-4 max-[520px]:px-4">

        {/* ── 头版:最新简报特稿(通栏,无框)── */}
        {feature && (
          <section className="mb-14">
            <SectionHeader title="最新简报" to="/digest" index={0} />
            <motion.div initial="hidden" animate="show" variants={fadeUp} custom={1}>
              <Link
                to={`/digest/${feature.topicId}/${feature.reportId}`}
                className="group block"
              >
                <h3
                  className="text-2xl font-bold leading-snug transition-colors duration-150"
                  style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}
                >
                  {feature.headline}
                </h3>
                {feature.deck && (
                  <p
                    className="mt-2.5 line-clamp-2 max-w-[52ch] text-sm leading-relaxed"
                    style={{ color: 'var(--ink-ghost)' }}
                  >
                    {feature.deck}
                  </p>
                )}
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="text-2xs tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
                    {formatShortDate(feature.publishedAt)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>
                    阅读本期 <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                  </span>
                </div>
              </Link>
            </motion.div>

            {/* 其余期次 — 细行,顶部一条分隔线把"头条"和"往期"分开 */}
            {digest.length > 1 && (
              <div className="mt-5 pt-1" style={{ borderTop: '0.5px solid var(--separator)' }}>
                {digest.slice(1).map((r, i) => (
                  <motion.div key={r.reportId} initial="hidden" animate="show" variants={fadeUp} custom={2 + i}>
                    <CompactRow
                      to={`/digest/${r.topicId}/${r.reportId}`}
                      title={r.headline}
                      meta={formatShortDate(r.publishedAt)}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── 下半:最近笔记(主列)+ 文集/图集(右栏)── */}
        <div className="flex flex-col gap-12 md:flex-row md:gap-16">

          {/* 最近笔记 — 主列 */}
          {notes.length > 0 && (
            <section className="min-w-0 md:flex-[1.6]">
              <SectionHeader title="最近笔记" to="/note" index={2} />
              <div className="flex flex-col">
                {notes.map((note, i) => (
                  <motion.div key={note.id} initial="hidden" animate="show" variants={fadeUp} custom={3 + i}>
                    <CompactRow
                      to={`/note?node=${note.id}`}
                      title={note.title}
                      meta={formatShortDate(note.updatedAt || note.createdAt)}
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* 右栏:近期文集 + 近期图集,纵向叠放 */}
          {(anthology.length > 0 || galleries.length > 0) && (
            <div className="flex min-w-0 flex-col gap-10 md:flex-1">
              {anthology.length > 0 && (
                <section>
                  <SectionHeader title="近期文集" to="/anthology" index={3} />
                  <div className="flex flex-col">
                    {anthology.map((a, i) => (
                      <motion.div key={a.id} initial="hidden" animate="show" variants={fadeUp} custom={4 + i}>
                        <CompactRow
                          to={`/anthology?node=${a.id}`}
                          title={a.title}
                          meta={`${a.entryCount} 篇`}
                        />
                      </motion.div>
                    ))}
                  </div>
                </section>
              )}

              {galleries.length > 0 && (
                <section>
                  <SectionHeader title="近期图集" to="/gallery" index={4} />
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {galleries.map((gallery, i) => (
                      <motion.div
                        key={gallery.id}
                        style={{ width: 116, flexShrink: 0 }}
                        initial="hidden"
                        animate="show"
                        variants={fadeUp}
                        custom={4 + i}
                      >
                        <Link
                          to={`/gallery?post=${gallery.id}`}
                          className="group block"
                        >
                          <div
                            className="overflow-hidden rounded-lg transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                            style={{ aspectRatio: '4/3' }}
                          >
                            {gallery.coverUrl ? (
                              <img src={gallery.coverUrl} alt={gallery.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full" style={{ background: 'var(--paper-dark)' }} />
                            )}
                          </div>
                          <div className="mt-1.5 truncate text-xs" style={{ color: 'var(--ink-light)' }}>
                            {gallery.title}
                          </div>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      </motion.div>
    </div>
  );
}
