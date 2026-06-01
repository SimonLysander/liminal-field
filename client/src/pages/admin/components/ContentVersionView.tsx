/*
 * ContentVersionView — 只读内容预览 + 版本操作
 *
 * 核心逻辑：中间区域始终展示某个版本（最新版或时间线选中的历史版本），
 * 操作按钮跟着"当前展示的版本"走，不再分 preview/非 preview 两套 UI。
 *
 * 版本状态：
 *   - 当前版本 = 已发布版 → 显示"已发布"状态 + "取消发布"操作
 *   - 当前版本 ≠ 已发布版 → 显示"已提交"状态 + "发布此版本"操作
 *   - 正在查看历史版本 → 额外显示"返回最新"
 */

import { useCallback, useState } from 'react';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/contexts/ConfirmContext';
import MarkdownBody from '@/components/shared/MarkdownBody';
import type { ContentVersionViewProps } from '../types';
import { LoadingState, ContentFade } from '@/components/LoadingState';

export const ContentVersionView = ({
  node,
  content,
  loading,
  error,
  preview,
  previewLoading,
  canEditSummary = true,
  onSaveSummary,
  onReload,
  onPublish,
  onUnpublish,
  onExitPreview,
  onPublishPreview,
  onEdit,
  onDelete,
  onMoveTo,
  onPublishAll,
}: ContentVersionViewProps) => {
  const confirm = useConfirm();

  /* 摘要 inline-edit：点击编辑图标进入编辑态，确认/取消退出 */
  const summary = content.latestVersion.summary;
  const [editingSummary, setEditingSummary] = useState(false);
  const [localSummary, setLocalSummary] = useState(summary);
  const [saving, setSaving] = useState(false);

  /* 外部 summary 变化时（切换文档）同步重置——渲染期比较 prev，避免 effect 级联渲染 */
  const [prevSummary, setPrevSummary] = useState(summary);
  if (summary !== prevSummary) {
    setPrevSummary(summary);
    setLocalSummary(summary);
    setEditingSummary(false);
  }

  const startEditSummary = useCallback(() => {
    if (!canEditSummary) return;
    setLocalSummary(summary);
    setEditingSummary(true);
  }, [canEditSummary, summary]);

  const cancelEditSummary = useCallback(() => {
    setLocalSummary(summary);
    setEditingSummary(false);
  }, [summary]);

  const confirmSummary = useCallback(async () => {
    if (!canEditSummary) return;
    setSaving(true);
    await onSaveSummary(localSummary);
    setSaving(false);
    setEditingSummary(false);
  }, [canEditSummary, localSummary, onSaveSummary]);

  /* 当前展示的版本是否为已发布版（用 versionId 对比） */
  const viewingVersionId = preview?.versionId ?? content.latestVersion.versionId;
  const isViewingPublished = viewingVersionId === content.publishedVersion?.versionId;
  const isViewingLatest = !preview;

  const handlePublish = async (): Promise<boolean> => {
    if (preview) {
      const ok = await confirm({
        title: '发布版本',
        message: `发布版本 ${preview.versionId.slice(0, 8)} ？`,
        confirmLabel: '发布',
      });
      if (!ok) return false;
      await onPublishPreview();
      return true;
    } else {
      const ok = await confirm({
        title: '发布',
        message: '立即发布最新的已提交版本？',
        confirmLabel: '发布',
      });
      if (!ok) return false;
      await onPublish();
      return true;
    }
  };

  const handleUnpublish = async (): Promise<boolean> => {
    const ok = await confirm({
      title: '取消发布',
      message: '立即取消发布此文档？',
      danger: true,
      confirmLabel: '取消发布',
    });
    if (!ok) return false;
    await onUnpublish();
    return true;
  };

  const stateKey = loading ? 'loading' : error ? 'error' : 'content';

  return (
    <ContentFade stateKey={stateKey}>
      {loading ? (
        <LoadingState label="加载内容中" />
      ) : error ? (
        <div className="rounded-xl p-4" style={{ background: 'var(--danger-soft)' }}>
          <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{error}</p>
        </div>
      ) : (
    <div className="space-y-4">
      {/* 不在此重复面包屑：左侧结构面板已表达层级，中间仅保留标题 + 正文 */}
      {/* Header — 始终显示，不因 preview 隐藏 */}
      <div className="flex items-start justify-between">
        <div>
          <h2
            className="text-5xl font-bold"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)', letterSpacing: '-0.025em' }}
          >
            {node.name}
          </h2>
          <div className="mt-2 flex items-center gap-2.5">
            <VersionStatusPill
              isPublished={isViewingPublished}
              commitHash={viewingVersionId}
            />
            {!preview && (
              <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                {new Date(content.updatedAt).toLocaleString('zh-CN')}
              </span>
            )}
            {preview && (
              <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                {new Date(preview.committedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
          {/* 最新版有未发布变更时的提醒（仅在查看最新版时显示） */}
          {isViewingLatest && content.status === 'published' && content.hasUnpublishedChanges && (
            <p className="mt-2 text-xs" style={{ color: 'var(--mark-red)' }}>
              公开页面仍在使用旧版本 {content.publishedVersion?.commitHash?.slice(0, 8) ?? '--'}，点击「发布」更新。
            </p>
          )}
        </div>

        {/* 操作按钮 — 跟着当前展示的版本走 */}
        <div className="flex items-center gap-4 pt-1">
          {isViewingLatest && (
            <TextLink label="刷新" onClick={() => void onReload()} />
          )}
          {!isViewingLatest && (
            <TextLink label="返回最新" onClick={onExitPreview} />
          )}
          <ActionButton
            label={isViewingPublished ? '取消发布' : '发布'}
            danger={isViewingPublished}
            onClick={isViewingPublished ? handleUnpublish : handlePublish}
          />

          {/* 低频管理操作 */}
          {(onEdit || onDelete || onMoveTo || onPublishAll) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  // focus 环的残留"框"在全局 index.css 收(aria-haspopup="menu":focus-visible 去环);
                  // 这里只补 open 态淡底,表达"菜单已展开"的激活反馈。
                  className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70 focus:outline-none data-[state=open]:bg-[var(--hover-overlay)] data-[state=open]:opacity-100"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  <MoreHorizontal size={14} strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[120px]">
                {/* 发布全部:仅对有子节点的节点显示,发布其子树 */}
                {onPublishAll && (
                  <>
                    <DropdownMenuItem onClick={() => void onPublishAll()}>
                      发布全部
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(node)}>
                    重命名
                  </DropdownMenuItem>
                )}
                {onMoveTo && (
                  <DropdownMenuItem onClick={() => onMoveTo(node)}>
                    移动到...
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(node)}
                      style={{ color: 'var(--mark-red)' }}
                    >
                      删除
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 摘要 — 当前版本可编辑，历史版本只读 */}
      {preview ? (
        preview.summary ? (
          <div
            className="rounded-md px-3 py-2 text-sm leading-relaxed"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
          >
            {preview.summary}
          </div>
        ) : null
      ) : (
        <div className="group relative -mb-1">
          <textarea
            value={editingSummary ? localSummary : summary}
            onChange={(e) => {
              if (!canEditSummary) return;
              if (e.target.value.length <= 300) setLocalSummary(e.target.value);
            }}
            readOnly={!canEditSummary || !editingSummary}
            placeholder="暂无摘要"
            rows={2}
            maxLength={300}
            className="w-full resize-none rounded-md text-sm leading-relaxed outline-none transition-colors duration-150"
            style={{
              background: 'var(--shelf)',
              color: editingSummary && canEditSummary ? 'var(--ink-light)' : 'var(--ink-faded)',
              padding: '8px 10px',
              border: editingSummary && canEditSummary ? '1px solid var(--separator)' : '1px solid transparent',
              cursor: editingSummary && canEditSummary ? 'text' : 'default',
            }}
          />
          <div
            className="mt-1 flex items-center justify-between"
            style={{ visibility: editingSummary && canEditSummary ? 'visible' : 'hidden' }}
          >
            <div className="flex items-center gap-2.5">
              <button
                className="text-2xs font-medium transition-opacity hover:opacity-70"
                style={{ color: 'var(--accent)' }}
                onClick={() => void confirmSummary()}
                disabled={saving}
              >
                {saving ? '保存中...' : '确认'}
              </button>
              <button
                className="text-2xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--ink-ghost)' }}
                onClick={cancelEditSummary}
              >
                取消
              </button>
            </div>
            <span className="text-2xs tabular-nums" style={{ color: 'var(--ink-ghost)' }}>
              {localSummary.length}/300
            </span>
          </div>
          {!editingSummary && canEditSummary && (
            <button
              className="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--paper)] group-hover:opacity-100"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={startEditSummary}
              title="编辑摘要"
            >
              <Pencil size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}

      {previewLoading && (
        <LoadingState label="加载版本内容中" />
      )}

      {/* Markdown body */}
      <div
        className="text-lg leading-[1.9]"
      >
        <MarkdownBody
          markdown={(preview ? preview.bodyMarkdown : content.bodyMarkdown) || ''}
          contentItemId={node.contentItemId}
        />
      </div>
    </div>
      )}
    </ContentFade>
  );
};

/* ---------- Primitives ---------- */

/** 版本状态标签：已发布（绿）或已提交（灰）+ commitHash */
function VersionStatusPill({ isPublished, commitHash }: { isPublished: boolean; commitHash: string }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-2xs font-medium"
      style={{
        background: isPublished ? 'var(--success-soft)' : 'var(--accent-soft)',
        color: isPublished ? 'var(--mark-green)' : 'var(--ink-faded)',
      }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: 'currentColor' }}
      />
      {isPublished ? '已发布' : '已提交'}
      <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
        {commitHash.slice(0, 8)}
      </span>
    </span>
  );
}

function TextLink({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : 'var(--ink-faded)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '4px 0',
      }}
      onMouseEnter={(e) => {
        if (!danger) e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = danger ? 'var(--mark-red)' : 'var(--ink-faded)';
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
