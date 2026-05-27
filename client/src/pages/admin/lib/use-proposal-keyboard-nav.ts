import { useEffect } from 'react';

/**
 * useProposalKeyboardNav —— 审批态全局快捷键。
 *
 * 仅在 enabled=true(controller.hasPending)时挂载 keydown listener:
 *   Y/y      接受当前 active hunk
 *   N/n      拒绝当前 active hunk
 *   J/j      下一个 pending hunk(循环)
 *   K/k      上一个 pending hunk(循环)
 *   ⌘/Ctrl+Enter     接受全部
 *   ⌘/Ctrl+Backspace 拒绝全部
 *
 * 守卫:
 *   - 焦点在 input/textarea/contenteditable 上不触发(用户正在打字)
 *   - 单字符快捷键不能带任何修饰键(避免 ⌘Y / ⌘N 等浏览器/系统组合误触)
 *   - activeHunkId 为空时 Y/N 静默 noop(没目标可操作)
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
  acceptAll: () => void;
  rejectAll: () => void;
}

/** 检查事件目标是不是"用户正在输入"的元素(避免在编辑器/聊天框打 Y/N 字符时触发) */
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
    acceptAll,
    rejectAll,
  } = options;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;

      // ⌘/Ctrl 组合键:全选/全拒
      if (mod && !e.altKey && !e.shiftKey) {
        if (e.key === 'Enter') {
          e.preventDefault();
          acceptAll();
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          rejectAll();
          return;
        }
        return;
      }

      // 单字符快捷键不能带任何修饰键(避免 ⌘Y / Ctrl+N 等系统组合误触)
      if (mod || e.altKey || e.shiftKey) return;

      switch (e.key) {
        case 'y':
        case 'Y':
          if (activeHunkId) {
            e.preventDefault();
            acceptOne(activeHunkId);
          }
          return;
        case 'n':
        case 'N':
          if (activeHunkId) {
            e.preventDefault();
            rejectOne(activeHunkId);
          }
          return;
        case 'j':
        case 'J':
        case 'ArrowDown':
          e.preventDefault();
          navigateNext();
          return;
        case 'k':
        case 'K':
        case 'ArrowUp':
          e.preventDefault();
          navigatePrev();
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    activeHunkId,
    acceptOne,
    rejectOne,
    navigateNext,
    navigatePrev,
    acceptAll,
    rejectAll,
  ]);
}
