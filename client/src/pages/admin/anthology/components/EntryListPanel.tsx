/**
 * EntryListPanel — 中栏第一级：文集条目列表
 *
 * 布局与 Notes ContentVersionView 对齐：
 *   - 标题行右侧放操作按钮（刷新 / 发布文集 / ... dropdown）
 *   - 发布状态标签跟在标题下方
 *   - 右侧面板不再有发布/删除操作
 */

import { useState } from 'react';
import { Plus, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { ActionButton } from '@/components/ui/action-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AnthologyAdminDetail, AnthologyAdminEntryMeta } from '@/services/workspace';
import { VersionStatusPill, TextLink } from './primitives';
import { AddEntryModal } from './AddEntryModal';

// ─── 条目列表行 ───

function EntryListRow({
  index,
  entry,
  onClick,
  onEdit,
  onDelete,
}: {
  index: number;
  entry: AnthologyAdminEntryMeta;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  /*
   * 条目发布状态圆点：
   * - 绿色：已发布且无未发布变更
   * - 红色：已发布但有未发布变更（需注意）
   * - 灰色：从未发布
   */
  const dotColor = entry.publishedVersionId
    ? entry.hasUnpublishedChanges
      ? 'var(--mark-red)'
      : 'var(--mark-green)'
    : 'var(--ink-ghost)';

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150"
      style={{ background: hovered ? 'var(--shelf)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* 序号 */}
      <span
        className="w-5 shrink-0 text-center text-xs tabular-nums"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {index}
      </span>

      {/* 状态圆点 */}
      <span
        className="shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: dotColor, display: 'inline-block' }}
        title={
          entry.publishedVersionId
            ? entry.hasUnpublishedChanges ? '有未发布的变更' : '已发布'
            : '未发布'
        }
      />

      {/* 标题 + 日期 */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {entry.title}
        </div>
        {entry.date && (
          <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {new Date(entry.date).toLocaleDateString('zh-CN')}
          </div>
        )}
      </div>

      {/* hover 显示操作按钮（阻止点击冒泡到行的 onClick） */}
      <div
        className="flex items-center gap-1 transition-opacity duration-150"
        style={{ opacity: hovered ? 1 : 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150"
          style={{ color: 'var(--ink-faded)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper)'; e.currentTarget.style.color = 'var(--ink)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-faded)'; }}
          onClick={onEdit}
          title="编辑"
        >
          <Pencil size={12} strokeWidth={1.5} />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150"
          style={{ color: 'var(--ink-ghost)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper)'; e.currentTarget.style.color = 'var(--mark-red)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-ghost)'; }}
          onClick={onDelete}
          title="删除"
        >
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ─── 面板主体 ───

interface EntryListPanelProps {
  detail: AnthologyAdminDetail;
  onEntryClick: (entryKey: string) => void;
  onAddEntry: (title: string) => Promise<void>;
  onEditEntry: (entryKey: string) => void;
  onDeleteEntry: (entryKey: string, entryTitle: string) => Promise<void>;
  /** 标题行：刷新文集详情 */
  onReload: () => void;
  /** 标题行：发布文集 */
  onPublish: () => Promise<boolean | void>;
  /** 标题行：取消发布文集 */
  onUnpublish: () => Promise<boolean | void>;
  /** 标题行 dropdown：批量发布所有条目 */
  onPublishAll: () => Promise<void>;
  /** 标题行 dropdown：删除文集 */
  onDeleteAnthology: () => Promise<void>;
}

export function EntryListPanel({
  detail,
  onEntryClick,
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
  onReload,
  onPublish,
  onUnpublish,
  onPublishAll,
  onDeleteAnthology,
}: EntryListPanelProps) {
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const isPublished = detail.status === 'published';

  return (
    <>
      <div className="flex-1 overflow-y-auto px-10 py-9 max-[520px]:px-4">
        <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
          {/* 标题行 — 与 Notes ContentVersionView 完全对齐 */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2
                className="font-bold"
                style={{
                  color: 'var(--ink)',
                  fontSize: 'var(--text-5xl)',
                  fontFamily: 'var(--font-serif)',
                  letterSpacing: '-0.025em',
                }}
              >
                {detail.title}
              </h2>
              <div className="mt-2 flex items-center gap-2.5">
                <VersionStatusPill isPublished={isPublished} />
                {detail.hasUnpublishedChanges && (
                  <span style={{ color: 'var(--mark-red)', fontSize: 'var(--text-2xs)' }}>
                    有未发布的变更
                  </span>
                )}
              </div>
            </div>

            {/* 操作按钮区 — gap-4 pt-1 与 Notes 一致 */}
            <div className="flex items-center gap-4 pt-1">
              <TextLink label="刷新" onClick={onReload} />
              <ActionButton
                label={isPublished ? '取消发布' : '发布文集'}
                danger={isPublished}
                onClick={isPublished ? onUnpublish : onPublish}
              />
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
                  <DropdownMenuItem onClick={() => void onPublishAll()}>
                    批量发布所有条目
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => void onDeleteAnthology()}
                    style={{ color: 'var(--mark-red)' }}
                  >
                    删除文集
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {detail.description && (
            <p className="mb-8 leading-relaxed text-sm" style={{ color: 'var(--ink-faded)' }}>
              {detail.description}
            </p>
          )}

          {/* 条目列表标头 */}
          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              条目 · {detail.entries.length} 篇
            </span>
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150"
              style={{ color: 'var(--ink-faded)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              onClick={() => setAddEntryOpen(true)}
            >
              <Plus size={11} strokeWidth={2} />
              添加条目
            </button>
          </div>

          {detail.entries.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-ghost)' }}>
              暂无条目，点击添加条目开始
            </p>
          ) : (
            <div className="space-y-0.5">
              {detail.entries.map((entry, i) => (
                <EntryListRow
                  key={entry.key}
                  index={i + 1}
                  entry={entry}
                  onClick={() => onEntryClick(entry.key)}
                  onEdit={() => onEditEntry(entry.key)}
                  onDelete={() => void onDeleteEntry(entry.key, entry.title)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AddEntryModal
        open={addEntryOpen}
        onClose={() => setAddEntryOpen(false)}
        onSubmit={onAddEntry}
      />
    </>
  );
}
