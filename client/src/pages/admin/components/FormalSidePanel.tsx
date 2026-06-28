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
  learningExists,
  onEnterLearning,
  onDiscardLearning,
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
  /** 该节点是否已有学习项目 —— 区分「开始学习」/「继续学习」 */
  learningExists?: boolean;
  /** 进入学习视图(另一扇门:对照读写台)。不传 = 不显示「学习」段(如文集 scope 无此门)。 */
  onEnterLearning?: () => void;
  /** 放弃学习:清掉主题 + 各篇 AI 产物(规划/初稿),保留篇目与我的草稿。仅 learningExists 时显示。 */
  onDiscardLearning?: () => void;
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

  const savedAtText = draftPresence.savedAt
    ? new Date(draftPresence.savedAt).toLocaleString('zh-CN')
    : '--';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 大纲 — flex-1，内部滚动；无标题时占位，避免布局跳动 */}
      <div className="mb-5 flex min-h-0 flex-1 flex-col">
        <SectionCaption>大纲</SectionCaption>
        <div ref={tocPanelRef} className="min-h-0 flex-1 overflow-y-auto">
          {toc.length > 0 ? (
            toc.map((item, i) => {
              const isActive = activeIndex === i;
              const basePadding = (item.level - 1) * 8 + 10;
              return (
                <motion.div
                  key={item.index}
                  className="cursor-pointer border-l-2 py-[5px] text-sm transition-all duration-200"
                  style={{
                    color: isActive ? 'var(--ink)' : 'var(--ink-faded)',
                    fontWeight: isActive ? 500 : 400,
                    borderColor: isActive ? 'var(--ink)' : 'transparent',
                    paddingLeft: `${basePadding}px`,
                  }}
                  animate={{ paddingLeft: isActive ? basePadding + 2 : basePadding }}
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
        <SectionCaption>编辑</SectionCaption>
        {draftPresence.exists ? (
          <div className="space-y-2">
            <InfoRow label="已有草稿" value="是" />
            <InfoRow label="上次保存" value={savedAtText} />
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

      {/* 学习 — shrink-0;另一扇门(对照读写台),用 accent 紫标识与「编辑」区分。
          仅在宿主传入 onEnterLearning 时显示(笔记 scope 有,文集 scope 无)。 */}
      {onEnterLearning && (
        <div className="mb-5 shrink-0">
          <SectionCaption>学习</SectionCaption>
          {learningExists ? (
            <div className="flex items-center gap-4">
              <SideLink label="继续学习 →" accent onClick={onEnterLearning} />
              {onDiscardLearning && (
                <SideLink label="放弃学习" onClick={onDiscardLearning} />
              )}
            </div>
          ) : (
            <>
              <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
                让 Aurora 规划并陪你逐篇学这个领域
              </p>
              <SideLink label="开始学习 →" accent onClick={onEnterLearning} />
            </>
          )}
        </div>
      )}

      {/* 版本 — flex-1，内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <SectionCaption>版本</SectionCaption>
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

/* 右栏段落 caption,uppercase 小字号,三段(大纲/编辑/版本)共用 */
function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
      style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
    >
      {children}
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
  accent,
  onClick,
}: {
  label: string;
  primary?: boolean;
  /** accent 紫 —— 标识「学习」这扇门,优先级高于 primary */
  accent?: boolean;
  onClick: () => void;
}) {
  const color = accent ? 'var(--accent)' : primary ? 'var(--ink)' : 'var(--ink-faded)';
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color,
        fontWeight: accent || primary ? 600 : 400,
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
