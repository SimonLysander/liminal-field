import { MousePointer2 } from 'lucide-react';
import type { AnchorPayload } from '@/pages/admin/lib/serialize-anchor';

interface Props {
  anchor: AnchorPayload;
}

/**
 * AnchorHint —— 聊天输入框上方"作用对象提示":让用户在说话前就知道
 * Aurora 这一发改动会落在哪。
 *   - range  → 「将改写选中『xxx…』」
 *   - cursor / none → 不显示(cursor 态已无对应工具，留给纯讨论或用户明确说"整体改"走 rewrite_document)
 *
 * 视觉:浅 accent 底 + ink-faded 文字 + 小图标,低调常驻不抢眼。
 * token:--accent / --ink-faded / --font-reading 均在 index.css 有双主题定义。
 */
export function AnchorHint({ anchor }: Props) {
  if (anchor.type !== 'range') return null;

  const baseStyle: React.CSSProperties = {
    color: 'var(--ink-faded)',
    background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
    fontFamily: 'var(--font-reading)',
  };

  const preview = anchor.textPreview ?? '';
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-xs" style={baseStyle}>
      <MousePointer2 size={12} strokeWidth={2} />
      <span className="truncate">
        Aurora 将改写选中:「{preview}{preview.length >= 40 ? '…' : ''}」
      </span>
    </div>
  );
}
