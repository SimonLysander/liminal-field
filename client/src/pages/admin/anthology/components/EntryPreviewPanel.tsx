/**
 * EntryPreviewPanel — 中栏第二级：条目内容预览
 *
 * 布局与 Notes ContentVersionView 完全对齐：
 *   - 返回按钮在标题上方
 *   - 标题行右侧放操作按钮（发布/取消发布条目 + ... dropdown 含删除条目）
 *   - 条目发布状态 Pill 跟在标题下方
 *
 * 版本预览模式：
 *   - 当 previewContent 非 null 时，展示历史版本内容而非最新版本
 *   - 标题行替换为"预览历史版本 · 返回最新"提示条，隐藏发布操作按钮
 *   - previewLoading 时展示加载态（不影响返回按钮）
 */

import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import MarkdownBody from '@/components/shared/MarkdownBody';
import type { AnthologyEntryDetail, AnthologyAdminEntryMeta } from '@/services/workspace';
import { VersionStatusPill, EmptyState } from './primitives';

interface EntryPreviewPanelProps {
  anthologyTitle: string;
  entry: AnthologyEntryDetail | null;
  entryMeta: AnthologyAdminEntryMeta | null;
  loading: boolean;
  /** 版本预览模式：历史版本内容（非 null 时覆盖 entry 展示） */
  previewContent: AnthologyEntryDetail | null;
  /** 版本预览加载中（正在拉取历史 snapshot） */
  previewLoading: boolean;
  /** 退出版本预览，返回最新版本 */
  onExitPreview: () => void;
  onBack: () => void;
  /** 标题行：发布条目 */
  onPublishEntry: () => Promise<boolean | void>;
  /** 标题行：取消发布条目 */
  onUnpublishEntry: () => Promise<boolean | void>;
  /** 标题行 dropdown：删除条目 */
  onDeleteEntry: () => Promise<void>;
}

export function EntryPreviewPanel({
  anthologyTitle,
  entry,
  entryMeta,
  loading,
  previewContent,
  previewLoading,
  onExitPreview,
  onBack,
  onPublishEntry,
  onUnpublishEntry,
  onDeleteEntry,
}: EntryPreviewPanelProps) {
  const isPublished = !!entryMeta?.publishedVersionId;
  const hasUnpublishedChanges = entryMeta?.hasUnpublishedChanges ?? false;

  // 版本预览模式：用历史版本内容覆盖最新版本；previewLoading 期间显示加载
  const isPreviewMode = previewContent !== null || previewLoading;
  const displayEntry = previewContent ?? entry;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-10 py-9 max-[520px]:px-4">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
          {/* 返回按钮 */}
          <button
            className="mb-6 text-xs flex items-center gap-1.5 transition-opacity duration-150 hover:opacity-70"
            style={{ color: 'var(--ink-faded)' }}
            onClick={onBack}
          >
            <ChevronLeft size={13} strokeWidth={1.5} />
            {anthologyTitle}
          </button>

          {/* 版本预览提示条：替换发布操作区，引导用户返回最新版本 */}
          {isPreviewMode && (
            <div
              className="mb-5 flex items-center justify-between rounded-md px-3.5 py-2"
              style={{ background: 'var(--shelf)', border: '1px solid var(--box-border)' }}
            >
              <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>
                正在预览历史版本
              </span>
              <button
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--ink-faded)' }}
                onClick={onExitPreview}
              >
                返回最新 →
              </button>
            </div>
          )}

          <ContentFade stateKey={loading || previewLoading ? 'loading' : displayEntry ? 'content' : 'empty'}>
            {loading || previewLoading ? (
              <LoadingState label={previewLoading ? '加载历史版本中' : '加载条目中'} />
            ) : displayEntry ? (
              <div className="space-y-4">
                {/* 标题行 — 与 Notes ContentVersionView 完全对齐 */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2
                      className="text-5xl font-bold"
                      style={{
                        color: 'var(--ink)',
                        fontFamily: 'var(--font-serif)',
                        letterSpacing: '-0.025em',
                      }}
                    >
                      {displayEntry.title}
                    </h2>
                    <div className="mt-2 flex items-center gap-2.5">
                      {/* 版本预览模式下不展示发布状态 Pill，避免误导 */}
                      {!isPreviewMode && <VersionStatusPill isPublished={isPublished} />}
                      {displayEntry.date && (
                        <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                          {new Date(displayEntry.date).toLocaleString('zh-CN')}
                        </span>
                      )}
                      {!isPreviewMode && isPublished && hasUnpublishedChanges && (
                        <span className="text-2xs" style={{ color: 'var(--mark-red)' }}>
                          有未发布的变更
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮区：版本预览模式下隐藏，避免对历史版本执行发布操作 */}
                  {!isPreviewMode && (
                    <div className="flex items-center gap-4 pt-1">
                      <ActionButton
                        label={isPublished ? '取消发布' : '发布条目'}
                        danger={isPublished}
                        onClick={isPublished ? onUnpublishEntry : onPublishEntry}
                      />
                      {/* 若已发布但有未发布变更，额外显示"重新发布"按钮 */}
                      {isPublished && hasUnpublishedChanges && (
                        <ActionButton
                          label="重新发布"
                          onClick={onPublishEntry}
                        />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70"
                            style={{ color: 'var(--ink-ghost)' }}
                          >
                            <MoreHorizontal size={14} strokeWidth={1.5} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[120px]">
                          <DropdownMenuItem
                            onClick={() => void onDeleteEntry()}
                            style={{ color: 'var(--mark-red)' }}
                          >
                            删除条目
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>

                {/* 条目正文 */}
                <div className="text-lg leading-[1.9]">
                  <MarkdownBody markdown={displayEntry.bodyMarkdown || ''} />
                </div>
              </div>
            ) : (
              <EmptyState message="条目内容加载失败" />
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}
