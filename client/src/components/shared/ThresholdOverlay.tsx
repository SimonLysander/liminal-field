/*
 * ThresholdOverlay — 全屏过渡遮罩
 *
 * 不透明主题色背景 + 阈限线动画 + 呼吸状态文字。
 *
 * 使用方式：
 *   <ThresholdOverlay visible={loading} label="正在导入内容..." />
 */

import { AnimatePresence, motion } from 'motion/react';
import { smoothBounce } from '@/lib/motion';

export function ThresholdOverlay({
  visible,
  label = '处理中...',
}: {
  visible: boolean;
  label?: string;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
          style={{ background: 'var(--paper)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: smoothBounce }}
        >
          {/* 阈限线 — 从中心展开 + 呼吸 */}
          <motion.div
            className="rounded-full"
            style={{ height: 1, background: 'var(--ink-light)' }}
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width: 120,
              opacity: [0, 1, 0.3, 1, 0.3],
            }}
            transition={{
              width: { duration: 0.5, ease: smoothBounce },
              opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 },
            }}
          />

          {/* 状态文字 — 呼吸动画 */}
          <motion.span
            className="mt-5 text-xs"
            style={{ color: 'var(--ink-ghost)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.4, 1, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          >
            {label}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
