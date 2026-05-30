import { useEffect, useRef, useState } from 'react';

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
  const latestTextRef = useRef<string | undefined>(undefined);
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const commitPickedText = (picked: string) => {
      latestTextRef.current = picked;

      // 拖拽选择会在 selectionchange 上逐字触发；若每次都 setState，会导致
      // ProseDraftEditor + 左侧长聊天列表高频重渲染，手动拖选容易被打断成 1-2 个字。
      // 这里等选区稳定一小段时间再更新 pill，不影响最终 add-to-chat 的选中文本。
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        setText((prev) =>
          prev === latestTextRef.current ? prev : latestTextRef.current,
        );
      }, 120);
    };

    const onSelectionChange = () => {
      const picked = getSelectionTextInContainer(containerSelector);
      if (picked) commitPickedText(picked);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, [containerSelector]);

  return text;
}

export function getSelectionTextInContainer(
  containerSelector: string,
): string | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;

  const node = sel.anchorNode;
  const elt =
    node && node.nodeType === 1
      ? (node as Element)
      : (node?.parentElement ?? null);
  if (!elt?.closest(containerSelector)) return undefined;

  const picked = sel.toString().trim();
  return picked || undefined;
}

export function findTextRangeInContainer(
  containerSelector: string,
  textSnapshot: string,
): Range | undefined {
  const container = document.querySelector(containerSelector);
  const needle = textSnapshot.trim();
  if (!container || !needle) return undefined;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const chunks: Array<{ node: Text; start: number; end: number }> = [];
  let fullText = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    const start = fullText.length;
    fullText += node.data;
    chunks.push({ node, start, end: fullText.length });
  }

  const foundAt = fullText.indexOf(needle);
  if (foundAt === -1) return undefined;

  const foundEnd = foundAt + needle.length;
  const startChunk = chunks.find((chunk) => foundAt < chunk.end);
  const endChunk = chunks.find((chunk) => foundEnd <= chunk.end);
  if (!startChunk || !endChunk) return undefined;

  const range = document.createRange();
  range.setStart(startChunk.node, foundAt - startChunk.start);
  range.setEnd(endChunk.node, foundEnd - endChunk.start);
  return range;
}

let activeHighlight: Highlight | undefined;

export function clearEditorTextHighlight() {
  if (!('highlights' in CSS)) return;
  CSS.highlights.delete('chat-selection');
  activeHighlight = undefined;
}

export function highlightTextInContainer(
  containerSelector: string,
  textSnapshot: string,
  opts: { scroll?: boolean } = {},
): boolean {
  const range = findTextRangeInContainer(containerSelector, textSnapshot);
  if (!range || !('highlights' in CSS)) return false;

  activeHighlight = new Highlight(range);
  CSS.highlights.set('chat-selection', activeHighlight);
  if (opts.scroll) {
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return true;
}
