import { useEffect, useState, type RefObject } from 'react';

/**
 * useScrollFade — 滚动渐隐遮罩(位置感知)。
 *
 * 只在「确实可滚动」时给容器上下边缘加 mask 渐隐:
 * - 顶部还有内容(scrollTop>0)才淡上缘;底部还有内容才淡下缘。
 * - 内容不溢出(短列表)→ 返回全不透明遮罩,等于无渐隐,避免首尾项被误淡。
 *
 * 返回值直接赋给 style.maskImage / WebkitMaskImage。
 * deps 变化(如列表项数量)时重算溢出状态。
 */
const FADE_PX = 28;

export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
): string {
  const [edge, setEdge] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      // 仅在真正变化时 setState,避免滚动事件高频重渲染
      setEdge((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // 内容/尺寸变化(加载完、窗口缩放)也要重算是否溢出
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const topStop = edge.top ? `transparent 0, #000 ${FADE_PX}px` : '#000 0';
  const bottomStop = edge.bottom
    ? `#000 calc(100% - ${FADE_PX}px), transparent 100%`
    : '#000 100%';
  return `linear-gradient(to bottom, ${topStop}, ${bottomStop})`;
}
