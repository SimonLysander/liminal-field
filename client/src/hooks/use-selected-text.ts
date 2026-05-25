import { useEffect, useState } from 'react';

/**
 * useSelectedText — 监听编辑器内的选中文本,供「选中→add-to-chat」。
 *
 * 用 DOM 的 selectionchange(编辑器无关、可靠;Plate v53 未暴露现成选区文本 API)。
 * 关键:**折叠选区时不清空、保留上次非空选中**——否则用户选完文字去点聊天框,
 * 选区一折叠 pill 就消失了。清除交给 AiAdvisorPanel 的"取消选区"按钮(dismiss)。
 *
 * @param containerSelector 选区必须落在此容器内才算数(如编辑器 '[data-slate-editor]')
 */
export function useSelectedText(containerSelector: string): string | undefined {
  const [text, setText] = useState<string>();

  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return; // 折叠不清空,保留上次
      const node = sel.anchorNode;
      const elt =
        node && node.nodeType === 1
          ? (node as Element)
          : (node?.parentElement ?? null);
      if (!elt?.closest(containerSelector)) return; // 选区不在目标编辑器内,忽略
      const picked = sel.toString().trim();
      if (picked) setText(picked);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', onSelectionChange);
  }, [containerSelector]);

  return text;
}
