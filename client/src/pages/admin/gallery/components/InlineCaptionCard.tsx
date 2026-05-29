/*
 * InlineCaptionCard — 画廊图说写手的内联落地卡片。
 *
 * 由 AdvisorSidebar 的 renderToolCard 注入,渲染在消息流里 propose_caption 工具调用的原位
 * (不再钉在底部)。点「应用」落到照片(useGalleryEditor.updateCaption)并就地反馈「已应用」。
 * 应用态是 UI 局部 state——刷新后复位无妨,caption 已落库,重复应用幂等。
 */
import { useState } from 'react';
import { Check } from 'lucide-react';

interface InlineCaptionCardProps {
  caption: string;
  reason?: string;
  /** 缩略图 URL(取不到则不显示) */
  photoUrl?: string;
  /** 目标照片是否仍在当前画廊(对话后照片可能被增删) */
  available: boolean;
  /** 应用到照片(= useGalleryEditor.updateCaption) */
  onApply: () => void;
}

export function InlineCaptionCard({
  caption,
  reason,
  photoUrl,
  available,
  onApply,
}: InlineCaptionCardProps) {
  const [applied, setApplied] = useState(false);
  const disabled = applied || !available;
  const label = applied ? '已应用' : available ? '应用' : '照片已移除';
  return (
    <div
      className="my-1 flex items-start gap-2 rounded-lg p-2"
      style={{ background: 'var(--shelf)' }}
    >
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug" style={{ color: 'var(--ink)' }}>
          {caption}
        </p>
        {reason && (
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {reason}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onApply();
          setApplied(true);
        }}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-default"
        style={
          applied
            ? { background: 'transparent', color: 'var(--success)' }
            : available
              ? { background: 'var(--accent)', color: 'var(--accent-contrast)' }
              : { background: 'transparent', color: 'var(--ink-ghost)' }
        }
        title={
          applied
            ? '已应用到这张照片'
            : available
              ? '应用到这张照片'
              : '这张照片已不在当前画廊'
        }
      >
        {applied ? <Check size={12} strokeWidth={2} /> : null}
        {label}
      </button>
    </div>
  );
}
