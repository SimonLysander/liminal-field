/**
 * LoadingState + ContentFade — 统一的加载状态与过渡动画
 *
 * LoadingState: 极简呼吸文字，三种变体（full/area/inline）。
 * 不用 spinner/dots，只靠 opacity 呼吸表达"进行中"，
 * 与项目整体的克制视觉语言保持一致。
 *
 * ContentFade: AnimatePresence 包装器，在 loading→content 之间
 * 提供平滑的淡入/微滑过渡，消除内容"突然跳出"的生硬感。
 */

import { AnimatePresence, motion } from 'motion/react';
import { smoothBounce } from '@/lib/motion';

type LoadingVariant = 'full' | 'area' | 'inline';

export function LoadingState({
  variant = 'area',
  label,
}: {
  variant?: LoadingVariant;
  label?: string;
}) {
  const text = label || '加载中';

  if (variant === 'inline') {
    return (
      <motion.span
        className="text-xs"
        style={{ color: 'var(--ink-ghost)' }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {text}
      </motion.span>
    );
  }

  const isFullScreen = variant === 'full';

  return (
    <motion.div
      className={
        isFullScreen
          ? 'flex h-screen items-center justify-center'
          : 'flex items-center justify-center py-12'
      }
      style={isFullScreen ? { background: 'var(--paper)' } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.span
        className="text-xs"
        style={{ color: 'var(--ink-ghost)' }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {text}
      </motion.span>
    </motion.div>
  );
}

/**
 * ContentFade — loading/error/content 状态切换的过渡容器。
 *
 * 用 stateKey 区分不同状态（如 'loading' / 'error' / 'content'），
 * AnimatePresence 在 key 变化时自动播放退出→进入动画，
 * 使用 smoothBounce 缓动 + 微小 y 偏移，和页面级过渡保持一致。
 */
export function ContentFade({
  children,
  stateKey,
  className,
}: {
  children: React.ReactNode;
  stateKey: string;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stateKey}
        className={className}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: smoothBounce }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
