/**
 * BannerContainer — 顶部居中轻量提示的渲染组件
 *
 * Apple HIG 风格：从顶部滑入，自动消失，半透明背景。
 * 命令式 API 在 banner-api.ts 中，避免 react-refresh 限制。
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { type BannerItem, subscribeBanner } from './banner-api';

const typeStyles: Record<string, { bg: string; color: string }> = {
  error: { bg: 'rgba(255, 59, 48, 0.9)', color: '#fff' },
  info: { bg: 'rgba(0, 0, 0, 0.75)', color: '#fff' },
  success: { bg: 'rgba(48, 209, 88, 0.9)', color: '#fff' },
};

/** 挂载在 App 根组件中，渲染顶部居中的 banner 堆栈 */
export function BannerContainer() {
  const [banners, setBanners] = useState<BannerItem[]>([]);

  useEffect(() => subscribeBanner(setBanners), []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex flex-col items-center gap-2 pt-3"
    >
      <AnimatePresence>
        {banners.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium shadow-lg"
            style={{
              background: typeStyles[b.type].bg,
              color: typeStyles[b.type].color,
              backdropFilter: 'blur(12px)',
              maxWidth: 480,
            }}
          >
            {b.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
