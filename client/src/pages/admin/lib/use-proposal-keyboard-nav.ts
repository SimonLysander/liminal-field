import { useEffect } from 'react';

/**
 * useProposalKeyboardNav —— 审批态全局快捷键。
 *
 * 列表选择心智(Finder / Spotlight 派),仅 3 个键:
 *   ↑          上一个 pending hunk(循环)
 *   ↓          下一个 pending hunk(循环)
 *   Enter      接受当前 active hunk
 *   Backspace  拒绝当前 active hunk
 *
 * 设计取舍:
 *   - 没有"全部接受/全部拒绝"快捷键(toolbar 按钮够用,这俩低频)
 *   - 没有 navigate 快捷键变体(j/k 等 vim 派) — ↑↓ 通用心智已足
 *   - 接管 ↑↓ 抢走浏览器默认页面滚动 — 审批是聚焦任务,navigate hunk 优先级
 *     高于自由滚动,且 active 切换会 scrollIntoView 把视野带过去,用户不太
 *     需要手动滚;真要手动滚走鼠标滚轮 / PageUp / PageDown
 *
 * 守卫:
 *   - 焦点在 input/textarea/contenteditable=true 时不触发(用户正在打字)
 *   - 单键不能带修饰键(避免 ⌘↑ / ⇧⏎ 等组合误触)
 *   - activeHunkId 为空时 Enter/Backspace 静默 noop(没目标可操作)
 *
 * 这个 hook 不知道是哪个 controller — 完全靠传入的回调驱动,便于测试和未来复用。
 */
export interface UseProposalKeyboardNavOptions {
  /** 仅在审批进行中挂监听,避免污染正常编辑态 */
  enabled: boolean;
  activeHunkId?: string;
  acceptOne: (hunkId: string) => void;
  rejectOne: (hunkId: string) => void;
  navigateNext: () => void;
  navigatePrev: () => void;
}

/** 检查事件目标是不是"用户正在输入"的元素(避免在聊天框敲 Enter 时触发) */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // contenteditable=true 的元素(Plate 编辑器、其他 rich text 区域)
  // 审批态主编辑器是 readOnly(contenteditable=false),不会误判
  // 但 advisor chat 输入框是 contenteditable=true,在这里打字不该触发
  if (target.isContentEditable) return true;
  return false;
}

export function useProposalKeyboardNav(
  options: UseProposalKeyboardNavOptions,
): void {
  const {
    enabled,
    activeHunkId,
    acceptOne,
    rejectOne,
    navigateNext,
    navigatePrev,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // 任何修饰键组合 → 不处理(交回浏览器/系统,避免 ⌘↑ 跳行首等被吞)
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          navigateNext();
          return;
        case 'ArrowUp':
          e.preventDefault();
          navigatePrev();
          return;
        case 'Enter':
          if (activeHunkId) {
            e.preventDefault();
            acceptOne(activeHunkId);
          }
          return;
        case 'Backspace':
          if (activeHunkId) {
            e.preventDefault();
            rejectOne(activeHunkId);
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, activeHunkId, acceptOne, rejectOne, navigateNext, navigatePrev]);
}
