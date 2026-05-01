import { motion } from 'motion/react';
import { appleEase } from '@/lib/motion';

/* ---------- Helpers ---------- */

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/* ---------- Mock Data ---------- */

const activities = [
  { date: 'Apr 22', text: '编辑了「阈限空间里的创作方法论」，新增第三章关于边界感知的段落。', type: '文稿' },
  { date: 'Apr 21', text: '上传了 4 张青岛海边的照片，标记为「扁平光」风格。', type: 'Gallery' },
  { date: 'Apr 20', text: 'Agent 分析了近期笔记，发现「通感」是反复出现的主题。', type: 'Agent' },
  { date: 'Apr 18', text: '完成了「声音的形状」初稿，约 1200 字。', type: '文稿' },
  { date: 'Apr 15', text: '新建标签「感官越境」，关联了 3 篇文稿和 7 张图片。', type: '标签' },
];

const features = [
  { label: '精选文稿', title: '阈限空间里的创作方法论', body: '在边界与边界之间，存在一种尚未被命名的状态。它不是混乱，而是一种更高维度的秩序。', count: '3 篇近期文稿' },
  { label: '精选图片', title: '青岛 · 四月的海', body: '扁平光下的海面像一块没有褶皱的灰色丝绸，所有的戏剧性都被天气抹平了。', count: '12 张近期图片' },
  { label: '站点企划', title: 'Liminal Field 开源计划', body: '配色系统已完成，下一步是组件库搭建和文稿编辑器的开发。', count: '进行中' },
];

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
  return (
    <div className="flex flex-1 flex-col gap-9 overflow-y-auto px-12 py-10">
      {/* Greeting */}
      <motion.div
        className="pb-1 pt-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: appleEase }}
      >
        <h1
          className="text-6xl font-bold leading-tight"
          style={{ color: 'var(--ink)', letterSpacing: '-0.025em' }}
        >
          {getGreeting()}
        </h1>
        <p className="mt-1.5 text-lg" style={{ color: 'var(--ink-ghost)' }}>
          11 篇文稿 · 47 张图片 · 18 个标签
        </p>
      </motion.div>

      {/* Activity feed */}
      <div>
        <div
          className="mb-3.5 text-base font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
        >
          最近活动
        </div>
        <div className="flex flex-col">
          {activities.map((a, i) => (
            <motion.div
              key={i}
              className="group flex cursor-default items-start gap-4 py-3.5 transition-colors duration-150"
              style={{ borderBottom: i < activities.length - 1 ? '0.5px solid var(--separator)' : 'none' }}
              custom={i}
              initial="hidden"
              animate="show"
              variants={fadeUp}
            >
              <span
                className="shrink-0 pt-px text-base tabular-nums"
                style={{ color: 'var(--ink-ghost)', minWidth: 48 }}
              >
                {a.date}
              </span>
              <span
                className="flex-1 text-lg leading-relaxed"
                style={{ color: 'var(--ink-light)', letterSpacing: '-0.003em' }}
              >
                {a.text}
              </span>
              <span
                className="shrink-0 rounded px-2 py-0.5 text-base"
                style={{ color: 'var(--ink-ghost)', background: 'var(--paper-dark)' }}
              >
                {a.type}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Feature cards */}
      <div>
        <div
          className="mb-3.5 text-base font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
        >
          精选
        </div>
        <div className="grid grid-cols-3 gap-3.5">
          {features.map((f, i) => (
            <motion.div
              key={i}
              className="hover-shadow-md flex cursor-pointer flex-col rounded-xl p-6 transition-all duration-300"
              style={{ background: 'var(--paper-dark)' }}
              custom={i + 3}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              whileHover={{ y: -2, transition: { duration: 0.25, ease: appleEase } }}
            >
              <div
                className="mb-3.5 text-base font-semibold uppercase"
                style={{ color: 'var(--ink-ghost)', letterSpacing: '0.03em' }}
              >
                {f.label}
              </div>
              <div
                className="mb-2 text-lg font-semibold leading-snug"
                style={{ color: 'var(--ink)', letterSpacing: '-0.015em' }}
              >
                {f.title}
              </div>
              <div
                className="text-md leading-relaxed"
                style={{ color: 'var(--ink-faded)', letterSpacing: '-0.003em' }}
              >
                {f.body}
              </div>
              <div
                className="mt-auto pt-4 text-base"
                style={{ color: 'var(--ink-ghost)' }}
              >
                {f.count}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
