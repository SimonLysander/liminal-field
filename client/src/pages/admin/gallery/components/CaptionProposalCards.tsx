/*
 * CaptionProposalCards — 画廊图说写手的「落地槽」内容。
 *
 * 作为 AdvisorSidebar 的 renderBelowMessages 渲染:把 agent 的 propose_caption 建议
 * 以缩略图卡片冒出,点「应用」落到照片(短文案不做 diff)。场景专属,只活在画廊。
 */
import { Check } from 'lucide-react';

export interface CaptionProposal {
  callId: string;
  fileName: string;
  caption: string;
  reason: string;
}

interface CaptionProposalCardsProps {
  proposals: CaptionProposal[];
  /** 按 fileName 取缩略图 URL(取不到则不显示缩略图) */
  photoUrl: (fileName: string) => string | undefined;
  /** 点「应用」:落 caption + 标记该建议已处理 */
  onApply: (fileName: string, caption: string, callId: string) => void;
}

export function CaptionProposalCards({
  proposals,
  photoUrl,
  onApply,
}: CaptionProposalCardsProps) {
  if (proposals.length === 0) return null;
  return (
    <div className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto px-3 pb-2">
      {proposals.map((cp) => {
        const url = photoUrl(cp.fileName);
        return (
          <div
            key={cp.callId}
            className="flex items-start gap-2 rounded-lg p-2"
            style={{ background: 'var(--shelf)' }}
          >
            {url && (
              <img
                src={url}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug" style={{ color: 'var(--ink)' }}>
                {cp.caption}
              </p>
              {cp.reason && (
                <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                  {cp.reason}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onApply(cp.fileName, cp.caption, cp.callId)}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              title="应用到这张照片"
            >
              <Check size={12} strokeWidth={2} />
              应用
            </button>
          </div>
        );
      })}
    </div>
  );
}
