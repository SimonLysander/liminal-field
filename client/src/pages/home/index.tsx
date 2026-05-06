import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';
import { homeApi } from '@/services/workspace';
import type { HomeData } from '@/services/workspace';

/* ---------- Helpers ---------- */

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/**
 * 将 ISO 时间格式化为动态感知的短日期：
 * - 当天显示"今天"，其余显示 M/D
 */
function formatActivityDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return '今天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ---------- 动画 ---------- */

/**
 * Staggered fade-up animation: each item delays by 50ms × index,
 * creating a cascading reveal effect.
 */
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.45, ease: appleEase },
  }),
};

/* ---------- Component ---------- */

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  // 首页数据加载：使用 cancelled flag 防止 StrictMode 双调或卸载后的 setState
  useEffect(() => {
    let cancelled = false;
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
    };
  }, []);

  // 从 latest 派生最近动态：过滤有变更记录的项，按变更时间降序，最多 6 条
  const activities = data
    ? [...data.latest]
        .filter((item) => !!item.latestChange)
        .sort(
          (a, b) =>
            new Date(b.latestChange!.createdAt).getTime() -
            new Date(a.latestChange!.createdAt).getTime(),
        )
        .slice(0, 6)
    : [];

  // 图集最多展示 3 张
  const galleries = data ? data.recentGallery.slice(0, 3) : [];

  return (
    <div className="flex flex-1 flex-col gap-9 overflow-y-auto px-12 py-10">
      {/* ── 区块 1：问候语 + 统计数字 ── */}
      <motion.div
        className="pb-1 pt-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: appleEase }}
      >
        <h1
          className="text-6xl font-bold leading-tight"
          style={{ color: 'var(--ink)', letterSpacing: 'var(--tracking-tight)' }}
        >
          {getGreeting()}
        </h1>
        {/* loading 期间以破折号占位，避免统计数字一闪而出 */}
        <p className="mt-1.5 text-lg" style={{ color: 'var(--ink-ghost)' }}>
          {loading
            ? '– 篇文稿 · – 张图片'
            : `${data?.stats.noteCount ?? 0} 篇文稿 · ${data?.stats.galleryCount ?? 0} 张图片`}
        </p>
      </motion.div>

      {/* ── 区块 2：最近动态 ── */}
      {!loading && (
        <div>
          <div
            className="mb-3.5 text-2xs font-semibold uppercase tracking-label"
            style={{ color: 'var(--ink-ghost)' }}
          >
            最近动态
          </div>

          {activities.length === 0 ? (
            /* 无动态时的空状态提示，保持与列表区对齐 */
            <p className="px-2 py-3 text-base" style={{ color: 'var(--ink-ghost)' }}>
              暂无最近动态
            </p>
          ) : (
            <div className="flex flex-col">
              {activities.map((item, i) => (
                <motion.div
                  key={item.id}
                  className="hover-overlay group flex cursor-default items-start gap-4 rounded-lg px-2 py-3.5"
                  style={{
                    transition: `background var(--duration-fast) var(--ease-out)`,
                  }}
                  custom={i}
                  initial="hidden"
                  animate="show"
                  variants={fadeUp}
                >
                  {/* 日期列：等宽数字，固定最小宽度对齐 */}
                  <span
                    className="shrink-0 pt-px text-base tabular-nums"
                    style={{ color: 'var(--ink-ghost)', minWidth: 48 }}
                  >
                    {formatActivityDate(item.latestChange!.createdAt)}
                  </span>

                  {/* 标题：可点击，跳转到对应文稿 */}
                  <Link
                    to={`/note?doc=${item.id}`}
                    className="flex-1 text-lg leading-relaxed hover:underline"
                    style={{ color: 'var(--ink-light)', letterSpacing: '-0.003em' }}
                  >
                    {item.title}
                  </Link>

                  {/* 变更说明：右侧小标签，背景色与文稿 pip 对应 */}
                  <span
                    className="shrink-0 rounded px-2 py-0.5 text-base"
                    style={{
                      color: 'var(--pip-a)',
                      background: 'var(--paper-dark)',
                    }}
                  >
                    {item.latestChange!.changeNote || '文稿'}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 区块 3：近期图集（无数据时整块隐藏） ── */}
      {!loading && galleries.length > 0 && (
        <div>
          <div
            className="mb-3.5 text-2xs font-semibold uppercase tracking-label"
            style={{ color: 'var(--ink-ghost)' }}
          >
            近期图集
          </div>

          {/* 3 列网格，与旧版 feature cards 保持一致 */}
          <div className="grid grid-cols-3 gap-3.5">
            {galleries.map((gallery, i) => (
              <motion.div
                key={gallery.id}
                custom={i}
                initial="hidden"
                animate="show"
                variants={fadeUp}
              >
                <Link
                  to={`/gallery?post=${gallery.id}`}
                  className="hover-card flex cursor-pointer flex-col overflow-hidden rounded-xl"
                  style={{ background: 'var(--paper-dark)' }}
                >
                  {/* 封面图：4:3 比例，object-cover 裁剪；无封面时用 paper-dark 占位色 */}
                  <div
                    className="w-full overflow-hidden rounded-t-xl"
                    style={{ aspectRatio: '4 / 3', background: 'var(--paper-dark)' }}
                  >
                    {gallery.coverUrl ? (
                      <img
                        src={gallery.coverUrl}
                        alt={gallery.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      /* 无封面占位块，保持布局不塌陷 */
                      <div className="h-full w-full" style={{ background: 'var(--paper-dark)' }} />
                    )}
                  </div>

                  {/* 卡片文字区 */}
                  <div className="flex flex-col gap-1 px-4 py-3">
                    <span
                      className="text-md font-semibold leading-snug"
                      style={{ color: 'var(--ink)', letterSpacing: '-0.015em' }}
                    >
                      {gallery.title}
                    </span>
                    {gallery.date && (
                      <span className="text-base" style={{ color: 'var(--ink-ghost)' }}>
                        {gallery.date.slice(0, 10)}
                      </span>
                    )}
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
