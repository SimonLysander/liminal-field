/*
 * ThresholdOverlay — 全屏过渡遮罩
 *
 * "阈限线"动画：一条 pip-a 色细线从中心展开，持续呼吸，
 * 配合状态文字表达"正在跨越状态"。
 * 视觉语言与项目名 "Liminal"（阈限/过渡）呼应。
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
          style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: smoothBounce }}
        >
          {/* 阈限线 — 从中心展开 + 呼吸 */}
          <motion.div
            className="rounded-full"
            style={{ height: 1, background: 'var(--pip-a)' }}
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width: 120,
              opacity: [0, 1, 0.4, 1, 0.4],
            }}
            transition={{
              width: { duration: 0.5, ease: smoothBounce },
              opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 },
            }}
          />

          {/* 状态文字 — 呼吸动画，与 LoadingState 一致 */}
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
