import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { VersionTimeline } from './VersionTimeline';
import type { DraftPresence } from '../types';
import type { ContentHistoryEntry } from '@/services/workspace';

export function FormalSidePanel({
  toc,
  activeIndex,
  onScrollToHeading,
  draftPresence,
  history,
  historyLoading,
  publishedVersionId,
  activeVersionId,
  onEditDraft,
  onSelectVersion,
}: {
  toc: Array<{ level: number; text: string; index: number }>;
  activeIndex: number;
  onScrollToHeading: (index: number) => void;
  draftPresence: DraftPresence;
  history: ContentHistoryEntry[];
  historyLoading: boolean;
  publishedVersionId: string | null;
  activeVersionId: string | null;
  onEditDraft: () => void;
  onSelectVersion: (versionId: string) => Promise<void>;
}) {
  const tocPanelRef = useRef<HTMLDivElement>(null);

  /* 大纲面板自动滚动：activeIndex 变化时，将激活项滚入可视区 */
  useEffect(() => {
    const panel = tocPanelRef.current;
    if (activeIndex < 0 || !panel) return;
    const activeEl = panel.children[activeIndex] as HTMLElement | undefined;
    if (!activeEl) return;
    const panelRect = panel.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    const offset = elRect.top - panelRect.top + panel.scrollTop;
    const target = offset - panel.clientHeight / 2 + activeEl.offsetHeight / 2;
    panel.scrollTo({ top: target, behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 大纲 — flex-1，内部滚动；无标题时占位，避免布局跳动 */}
      <div className="mb-5 flex min-h-0 flex-1 flex-col">
        <div
          className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          大纲
        </div>
        <div ref={tocPanelRef} className="min-h-0 flex-1 overflow-y-auto">
          {toc.length > 0 ? (
            toc.map((item, i) => {
              const isActive = activeIndex === i;
              return (
                <motion.div
                  key={item.index}
                  className="cursor-pointer border-l-2 py-[5px] text-sm transition-all duration-200"
                  style={{
                    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
                    fontWeight: isActive ? 500 : 400,
                    borderColor: isActive ? 'var(--ink)' : 'transparent',
                    paddingLeft: `${(item.level - 1) * 8 + 10}px`,
                  }}
                  animate={{ paddingLeft: isActive ? (item.level - 1) * 8 + 12 : (item.level - 1) * 8 + 10 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={() => onScrollToHeading(i)}
                >
                  {item.text}
                </motion.div>
              );
            })
          ) : (
            <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无标题</p>
          )}
        </div>
      </div>

      {/* 编辑 — shrink-0，固定高度 */}
      <div className="mb-5 shrink-0">
        <div
          className="mb-2.5 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          编辑
        </div>
        {draftPresence.exists ? (
          <div className="space-y-2">
            <InfoRow label="已有草稿" value="是" />
            <InfoRow
              label="上次保存"
              value={draftPresence.savedAt ? new Date(draftPresence.savedAt).toLocaleString('zh-CN') : '--'}
            />
            <div className="flex gap-4 pt-2">
              <SideLink label="继续编辑 →" primary onClick={onEditDraft} />
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
              进入编辑器创建草稿
            </p>
            <SideLink label="开始编辑 →" primary onClick={onEditDraft} />
          </>
        )}
      </div>

      {/* 版本 — flex-1，内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
        >
          版本
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ContentFade stateKey={historyLoading ? 'loading' : 'history'}>
            {historyLoading ? (
              <LoadingState />
            ) : history.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无版本</p>
            ) : (
              <VersionTimeline
                history={history}
                publishedVersionId={publishedVersionId}
                activeVersionId={activeVersionId}
                onSelect={(versionId) => void onSelectVersion(versionId)}
              />
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function SideLink({
  label,
  primary,
  danger,
  onClick,
}: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
