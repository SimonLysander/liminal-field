/**
 * EntrySidePanel — 右栏第二级：条目信息面板
 *
 * 与 Notes FormalSidePanel 结构完全对齐，只保留：
 *   - 编辑（草稿状态 + 继续编辑/覆盖重建）
 *   - 版本时间线
 *
 * 发布/取消发布操作已移至中栏标题行，此处不再重复。
 *
 * 编辑 URL 使用 window.location.href 硬刷新（Plate editor inputRules
 * 在 SPA 导航后不生效，参见 CLAUDE.md 踩坑记录）。
 */

import { LoadingState, ContentFade } from '@/components/LoadingState';
import { VersionTimeline } from '../../components/VersionTimeline';
import type { AnthologyAdminEntryMeta, ContentHistoryEntry, EditorDraft } from '@/services/workspace';
import { SectionLabel, InfoRow, SideLink } from './primitives';

interface EntrySidePanelProps {
  anthologyId: string;
  entryKey: string;
  entryMeta: AnthologyAdminEntryMeta | null;
  draft: EditorDraft | null;
  draftLoading: boolean;
  history: ContentHistoryEntry[];
  historyLoading: boolean;
  activeVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  onOverwriteDraft: () => Promise<void>;
}

export function EntrySidePanel({
  anthologyId,
  entryKey,
  entryMeta,
  draft,
  draftLoading,
  history,
  historyLoading,
  activeVersionId,
  onSelectVersion,
  onOverwriteDraft,
}: EntrySidePanelProps) {
  const editUrl = `/admin/anthology/${anthologyId}/entries/${entryKey}/edit`;

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden px-5 py-7"
      style={{ width: 'var(--layout-context)' }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 编辑区块 — 与 Notes FormalSidePanel 完全一致 */}
        <div className="mb-5 shrink-0">
          <SectionLabel>编辑</SectionLabel>
          <ContentFade stateKey={draftLoading ? 'loading' : draft ? 'draft' : 'no-draft'}>
            {draftLoading ? (
              <LoadingState variant="inline" label="检查草稿" />
            ) : draft ? (
              <div className="space-y-2">
                <InfoRow label="已有草稿" value="是" />
                <InfoRow
                  label="上次保存"
                  value={new Date(draft.savedAt).toLocaleString('zh-CN')}
                />
                <div className="flex gap-4 pt-2">
                  <SideLink
                    label="继续编辑 →"
                    primary
                    onClick={() => { window.location.href = editUrl; }}
                  />
                  <SideLink
                    label="覆盖重建"
                    danger
                    onClick={() => void onOverwriteDraft()}
                  />
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
                  进入编辑器创建草稿
                </p>
                <SideLink
                  label="开始编辑 →"
                  primary
                  onClick={() => { window.location.href = editUrl; }}
                />
              </>
            )}
          </ContentFade>
        </div>

        {/* 版本时间线区块 — flex-1，内部滚动，与 Notes FormalSidePanel 完全一致 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <SectionLabel>版本</SectionLabel>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ContentFade stateKey={historyLoading ? 'loading' : 'history'}>
              {historyLoading ? (
                <LoadingState />
              ) : history.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无版本</p>
              ) : (
                <VersionTimeline
                  history={history}
                  publishedVersionId={entryMeta?.publishedVersionId ?? null}
                  activeVersionId={activeVersionId}
                  onSelect={(versionId) => onSelectVersion(versionId)}
                />
              )}
            </ContentFade>
          </div>
        </div>
      </div>
    </aside>
  );
}
