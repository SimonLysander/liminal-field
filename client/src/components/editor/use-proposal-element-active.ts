import { useContext, useEffect, useRef } from 'react';
import { ProposalControlsContext } from './proposal-controls-context';

/**
 * useProposalElementActive —— 给 proposal-old / proposal-new element 共用的
 * "我是不是当前 active hunk" 状态 + 自动 scrollIntoView + 点击切焦点处理。
 *
 * 抽出来避免两个 element 各写一遍同样的逻辑。
 *
 * 返回值:
 *   - ref:挂到 PlateElement 的根 DOM 节点。同时承担两件事:
 *       1) active 切换时自动 scrollIntoView 到视口
 *       2) 内部用 DOM addEventListener 监听 pointerdown,点击切焦点
 *      不通过 React onPointerDown prop 是因为 PlateElement 类型不接 DOM 事件
 *      props(Plate 内部自己管事件路由),走原生 listener 是最稳的旁路。
 *   - isActive:渲染时用来加视觉高亮(box-shadow / borderLeft 加粗)
 */
export function useProposalElementActive(hunkId: string | undefined) {
  const ctx = useContext(ProposalControlsContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const isActive = !!hunkId && ctx?.activeHunkId === hunkId;

  // active 切换时把当前节点滚到视口 — 用 nearest 防止疯狂跳屏
  // 单 hunk 跨越 OLD + NEW 两个 element,两个都会 scrollIntoView,但
  // 它们紧邻所以最后一个生效的就是 NEW(在 OLD 下方),效果是停在 NEW 上,挺合理。
  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  // 原生 pointerdown listener:点击节点区域切焦点(让 Y/N 快捷键跟着走)
  // 不用 React onPointerDown 是因为 PlateElement 类型不接 DOM 事件 props
  useEffect(() => {
    const el = ref.current;
    if (!el || !hunkId || !ctx?.setActiveHunkId) return;
    const handler = () => ctx.setActiveHunkId(hunkId);
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [hunkId, ctx]);

  return { ref, isActive };
}
