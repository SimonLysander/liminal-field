import { useCallback, useEffect, useRef, useState } from 'react';
import { TextQuote } from 'lucide-react';

/**
 * ChatQuoteButton —— 在 Aurora 消息里划词时,浮出一个「引用」按钮(B 方案)。
 *
 * 跟编辑器划词「添加到聊天」同一个心智:选中 Aurora 的话 → 浮出按钮 → 点它把这段引用进
 * 输入框(chip)。聊天消息是普通展示 DOM(非 Plate),所以用原生 window.getSelection 定位:
 * 选区落在 [data-aurora-msg] 内(助手消息)才算,按钮 fixed 在选区右上角(视口坐标)。
 *
 * 设计:
 * - 只认助手消息内的选区,用户消息 / 工具卡片划词不触发。
 * - 选区折叠 / 滚动 / 改窗口尺寸 → 隐藏(不做跟随重定位,够用且不抖)。
 * - 点按钮:取选区文本回调 onQuote,再清选区。mousedown 阻断默认,防点击时先清掉选区。
 */
export function ChatQuoteButton({ onQuote }: { onQuote: (text: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const textRef = useRef('');

  const hide = useCallback(() => {
    setPos(null);
    textRef.current = '';
  }, []);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();

      const node = sel.anchorNode;
      const elt =
        node && node.nodeType === 1
          ? (node as Element)
          : node?.parentElement ?? null;
      if (!elt?.closest('[data-aurora-msg]')) return hide();

      const text = sel.toString().trim();
      if (!text) return hide();

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return hide();

      textRef.current = text;
      // 选区右上角(fixed 视口坐标);按钮自身用 translateX(-100%) 贴右、上移避开文字。
      setPos({ x: rect.right, y: rect.top });
    };

    // selectionchange 用 rAF 防抖(拖选会高频触发)。
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    document.addEventListener('selectionchange', onChange);
    // 滚动 / 改尺寸时按钮位置会失准,直接隐藏(不跟随)。
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hide]);

  if (!pos) return null;

  return (
    <button
      type="button"
      // mousedown 阻断默认:chip 按钮点下时浏览器会清掉选区,preventDefault 保住它;
      // 此时 textRef 已在 selectionchange 里存好,onClick 直接用。
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() => {
        const text = textRef.current;
        if (text) onQuote(text);
        window.getSelection()?.removeAllRanges();
        hide();
      }}
      className="fixed z-50 flex w-max items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-2xs transition-colors"
      style={{
        left: pos.x,
        top: pos.y - 36,
        transform: 'translateX(-100%)',
        // 纸感克制:浅纸底 + 细分隔线 + 柔投影,跟项目其它浮层(hovercard)同语言,不抢眼
        background: 'var(--paper)',
        color: 'var(--ink-faded)',
        border: '0.5px solid var(--separator)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ink-faded)';
      }}
    >
      <TextQuote size={11} strokeWidth={1.6} />
      引用
    </button>
  );
}
