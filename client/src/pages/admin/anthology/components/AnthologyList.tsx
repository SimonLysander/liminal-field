/**
 * AnthologyList — 左栏文集列表
 *
 * 显示所有文集，底部有刷新 + 新建按钮。
 * 选中状态由父组件通过 selectedId 控制，与 URL 保持同步。
 */

import { Plus, RefreshCw } from 'lucide-react';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import type { AnthologyAdminListItem } from '@/services/workspace';
import { CreateAnthologyPopover } from './CreateAnthologyPopover';

// ─── 列表项 ───

function AnthologyListItem({
  item,
  isSelected,
  onClick,
}: {
  item: AnthologyAdminListItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  /* 状态圆点色：已发布=绿色，其他=灰色 */
  const dotColor = item.status === 'published' ? 'var(--mark-green)' : 'var(--ink-ghost)';

  return (
    <button
      className="w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--shelf)]"
      style={{ background: isSelected ? 'var(--accent-soft)' : 'transparent' }}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: dotColor, display: 'inline-block' }}
          title={item.status === 'published' ? '已发布' : '已提交'}
        />
        <span
          className="truncate text-sm"
          style={{ color: 'var(--ink)', fontWeight: isSelected ? 500 : 400 }}
        >
          {item.title}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-[14px]">
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {item.entryCount} 篇
        </span>
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </button>
  );
}

// ─── 列表容器 ───

interface AnthologyListProps {
  anthologies: AnthologyAdminListItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReload: () => void;
  /** 提交新建文集(就近浮层内调用) */
  onCreateSubmit: (title: string) => Promise<void>;
}

export function AnthologyList({
  anthologies,
  loading,
  selectedId,
  onSelect,
  onReload,
  onCreateSubmit,
}: AnthologyListProps) {
  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden"
      style={{
        width: 'var(--layout-sidebar)',
        background: 'var(--sidebar-bg)',
        borderRight: '0.5px solid var(--separator)',
      }}
    >
      <div className="px-5 pt-5 pb-1">
        <div className="text-base font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          文集管理
        </div>
        <div className="mt-1 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
          {anthologies.length} 个文集
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2.5 pb-4">
        <ContentFade stateKey={loading ? 'loading' : 'list'}>
          {loading ? (
            <LoadingState />
          ) : anthologies.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
              暂无文集
            </div>
          ) : (
            <div className="mt-1">
              {anthologies.map((anthology) => (
                <AnthologyListItem
                  key={anthology.id}
                  item={anthology}
                  isSelected={selectedId === anthology.id}
                  onClick={() => onSelect(anthology.id)}
                />
              ))}
            </div>
          )}
        </ContentFade>
      </div>

      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderTop: '0.5px solid var(--separator)' }}
      >
        <button
          className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base transition-colors duration-150"
          style={{ color: 'var(--ink-faded)' }}
          onClick={onReload}
        >
          <RefreshCw size={9} strokeWidth={1.5} />
          刷新
        </button>
        <CreateAnthologyPopover onSubmit={onCreateSubmit}>
          <button
            className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base font-medium transition-colors duration-150"
            style={{ color: 'var(--ink)' }}
          >
            <Plus size={10} strokeWidth={2} />
            新建
          </button>
        </CreateAnthologyPopover>
      </div>
    </aside>
  );
}
