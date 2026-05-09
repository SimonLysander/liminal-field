/**
 * banner — 顶部居中轻量提示的命令式 API
 *
 * 用法：
 *   import { banner } from '@/components/ui/banner-api';
 *   banner.error('操作失败');
 *   banner.info('会话已过期');
 */

type BannerType = 'error' | 'info' | 'success';

export interface BannerItem {
  id: number;
  type: BannerType;
  message: string;
}

// 全局状态：通过回调通知 React 组件更新
let nextId = 0;
let listener: ((items: BannerItem[]) => void) | null = null;
let items: BannerItem[] = [];

function notify() {
  listener?.([...items]);
}

function addBanner(type: BannerType, message: string, duration = 2500) {
  const id = nextId++;
  items = [...items, { id, type, message }];
  notify();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    notify();
  }, duration);
}

/** 命令式 API，在任意位置调用 */
export const banner = {
  error: (message: string, duration?: number) => addBanner('error', message, duration),
  info: (message: string, duration?: number) => addBanner('info', message, duration ?? 2000),
  success: (message: string, duration?: number) => addBanner('success', message, duration ?? 1800),
};

/** 供 BannerContainer 组件订阅状态变化 */
export function subscribeBanner(cb: (items: BannerItem[]) => void): () => void {
  listener = cb;
  return () => { listener = null; };
}
