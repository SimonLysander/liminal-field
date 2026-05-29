/*
 * AdminStructurePanel — 面包屑钻入式导航面板
 *
 * 替代原 TreePanel 的递归树结构，改为一次只显示一个层级。
 * 交互模式对齐展示端 Sidebar 的面包屑钻入，管理端特有功能：
 *   - 同级拖拽排序（仅 before/after，无 inside）
 *   - visibility: 'all'（可见未发布内容）
 * 节点操作（重命名/删除/移动）统一由中间面板承载，sidebar 只负责导航。
 *
 * 字号全部使用 Tailwind class（text-base / text-xs / text-2xs），
 * 与展示端 Sidebar 保持同一套 token，不用 inline fontSize。
 */

import { ContentFade, LoadingState } from '@/components/LoadingState';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { StructureNode } from '@/services/structure';
import { ChevronLeft, ChevronRight, Folder, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

/* ---------- Types ---------- */

export type BreadcrumbItem = { id: string; name: string };

type DropPosition = 'before' | 'after';
type DropTarget = { nodeId: string; position: DropPosition };

/* ---------- Props ---------- */

type AdminStructurePanelProps = {
  nodes: StructureNode[];
  loading: boolean;
  error: string;
  selectedNodeId: string | null;
  breadcrumb: BreadcrumbItem[];
  /** URL 中的 topic param，直接作为新建操作的 parentId（不从 breadcrumb 推导，避免异步落后） */
  currentParentId: string | undefined;
  onReload: () => void;
  onSelect: (node: StructureNode) => void;
  onEnterFolder: (node: StructureNode) => void;
  onGoToBreadcrumb: (index: number | null) => void;
  onAddChild: (parentId?: string) => void;
  onReorder: (nodeId: string, targetNodeId: string, position: DropPosition) => void;
};

/* ---------- Node list item ---------- */

function NodeItem({
  node,
  contentIndex,
  isSelected,
  isDragging,
  dropTarget,
  onSelect,
  onEnterFolder,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  node: StructureNode;
  /** 内容项序号（文件夹不参与计数），null 表示文件夹。 */
  contentIndex: number | null;
  isSelected: boolean;
  isDragging: boolean;
  dropTarget: DropTarget | null;
  onSelect: (node: StructureNode) => void;
  onEnterFolder: (node: StructureNode) => void;
  onDragStart: (nodeId: string) => void;
  onDragOver: (e: React.DragEvent, nodeId: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const isFolder = node.type === 'FOLDER';
  const isDropTarget = dropTarget?.nodeId === node.id;

  return (
    <div style={{ opacity: isDragging ? 0.4 : 1 }}>
      {/* Before drop indicator */}
      {isDropTarget && dropTarget.position === 'before' && (
        <div
          style={{
            height: 2,
            background: 'var(--mark-blue)',
            marginLeft: 12,
            marginRight: 8,
            borderRadius: 1,
          }}
        />
      )}

      <div
        className="hover-shelf group relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-all duration-150"
        style={{
          background: isSelected ? 'var(--shelf)' : undefined,
          color: isSelected ? 'var(--ink)' : 'var(--ink-light)',
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.id);
          onDragStart(node.id);
        }}
        onDragOver={(e) => onDragOver(e, node.id)}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        onClick={() => {
          if (isFolder) {
            onEnterFolder(node);
          } else {
            onSelect(node);
          }
        }}
      >
        {/* Icon / 序号 */}
        {isFolder ? (
          <Folder
            size={14}
            strokeWidth={1.5}
            className="shrink-0"
            style={{ color: isSelected ? 'var(--ink)' : 'var(--ink-ghost)' }}
          />
        ) : (
          <span
            className="w-5 shrink-0 text-2xs tabular-nums"
            style={{
              color: isSelected ? 'var(--ink-faded)' : 'var(--ink-ghost)',
              letterSpacing: '0.02em',
            }}
          >
            {contentIndex !== null ? String(contentIndex).padStart(2, '0') : ''}
          </span>
        )}

        <span
          className="min-w-0 flex-1 truncate text-base"
          style={{ fontWeight: isSelected ? 500 : 400 }}
        >
          {node.name}
        </span>

        {/* 文件夹用 chevron 提示可展开 */}
        {isFolder && (
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className="shrink-0"
            style={{ color: 'var(--ink-ghost)' }}
          />
        )}
      </div>

      {/* After drop indicator */}
      {isDropTarget && dropTarget.position === 'after' && (
        <div
          style={{
            height: 2,
            background: 'var(--mark-blue)',
            marginLeft: 12,
            marginRight: 8,
            borderRadius: 1,
          }}
        />
      )}
    </div>
  );
}

/* ---------- Main panel ---------- */

export function AdminStructurePanel({
  nodes,
  loading,
  error,
  selectedNodeId,
  breadcrumb,
  currentParentId,
  onReload,
  onSelect,
  onEnterFolder,
  onGoToBreadcrumb,
  onAddChild,
  onReorder,
}: AdminStructurePanelProps) {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const handleDragStart = useCallback((nodeId: string) => {
    setDraggedNodeId(nodeId);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, nodeId: string) => {
      e.preventDefault();
      e.stopPropagation();

      if (!draggedNodeId || draggedNodeId === nodeId) {
        setDropTarget(null);
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const position: DropPosition = y < rect.height * 0.5 ? 'before' : 'after';

      setDropTarget({ nodeId, position });
    },
    [draggedNodeId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!draggedNodeId || !dropTarget) {
        handleDragEnd();
        return;
      }

      onReorder(draggedNodeId, dropTarget.nodeId, dropTarget.position);
      handleDragEnd();
    },
    [draggedNodeId, dropTarget, onReorder, handleDragEnd],
  );

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden"
      style={{
        width: 'var(--layout-sidebar)',
        background: 'var(--sidebar-bg)',
        borderRight: '0.5px solid var(--separator)',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-1">
        <div
          className="text-base font-semibold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          内容管理
        </div>
        <div className="mt-1 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
          {nodes.length} 个项目
        </div>
      </div>

      {/* 面包屑导航 */}
      <div className="mt-3 px-5 pb-2">
        {breadcrumb.length === 0 ? (
          <span
            className="text-2xs font-semibold uppercase"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
          >
            结构
          </span>
        ) : (
          <div className="flex items-center whitespace-nowrap">
            <span
              className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150"
              style={{ color: 'var(--ink-faded)' }}
              onClick={() =>
                breadcrumb.length >= 2
                  ? onGoToBreadcrumb(breadcrumb.length - 2)
                  : onGoToBreadcrumb(null)
              }
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </span>
            <div className="flex min-w-0 items-center">
              {breadcrumb.length === 1 ? (
                <span
                  className="max-w-[120px] cursor-pointer truncate rounded px-1 py-0.5 text-xs transition-colors duration-150"
                  style={{ color: 'var(--ink-light)' }}
                  title={breadcrumb[0].name}
                  // 点父级页面名 → 进入该页(它自己也是一篇笔记),不是回根目录。
                  // (回根用左侧 < 箭头;面包屑名代表"这个页面",点它应打开它的正文。)
                  onClick={() => onGoToBreadcrumb(0)}
                >
                  {breadcrumb[0].name}
                </span>
              ) : (
                /* 2+ 级：… / 直接父级名，hover … 弹出完整路径 */
                <>
                  <HoverCard openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <span
                        className="cursor-pointer rounded px-1 py-0.5 text-xs transition-colors duration-150"
                        style={{ color: 'var(--ink-ghost)' }}
                      >
                        …
                      </span>
                    </HoverCardTrigger>
                    <HoverCardContent
                      align="start"
                      sideOffset={4}
                      className="w-auto min-w-[140px] max-w-[200px] rounded-lg p-1.5"
                      style={{
                        border: 'none',
                        background: 'var(--sidebar-bg)',
                        boxShadow:
                          '0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.06)',
                      }}
                    >
                      <div
                        className="flex cursor-pointer items-center gap-2 truncate rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                        style={{ color: 'var(--ink-light)' }}
                        onClick={() => onGoToBreadcrumb(null)}
                      >
                        <Folder
                          size={13}
                          strokeWidth={1.5}
                          className="shrink-0"
                          style={{ color: 'var(--ink-ghost)' }}
                        />
                        根目录
                      </div>
                      {breadcrumb.slice(0, -1).map((item, i) => (
                        <div
                          key={item.id}
                          className="flex cursor-pointer items-center gap-2 truncate rounded-lg py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                          style={{
                            color: 'var(--ink-light)',
                            paddingLeft: `${(i + 1) * 10 + 10}px`,
                            paddingRight: 10,
                          }}
                          onClick={() => onGoToBreadcrumb(i)}
                        >
                          <Folder
                            size={13}
                            strokeWidth={1.5}
                            className="shrink-0"
                            style={{ color: 'var(--ink-ghost)' }}
                          />
                          {item.name}
                        </div>
                      ))}
                    </HoverCardContent>
                  </HoverCard>
                  <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                    /
                  </span>
                  <span
                    className="max-w-[100px] truncate text-xs"
                    style={{ color: 'var(--ink-light)' }}
                  >
                    {breadcrumb[breadcrumb.length - 1].name}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Node list — 当前层级 */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        <ContentFade
          stateKey={loading ? 'loading' : error ? 'error' : `list-${currentParentId || 'root'}`}
        >
          {loading ? (
            <LoadingState />
          ) : error ? (
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,59,48,0.06)' }}>
              <p className="text-xs" style={{ color: 'var(--mark-red)' }}>
                {error}
              </p>
              <button
                className="mt-2 text-xs font-medium transition-colors duration-150"
                style={{ color: 'var(--ink-faded)' }}
                onClick={onReload}
              >
                重试
              </button>
            </div>
          ) : nodes.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
              暂无内容
            </div>
          ) : (
            <div>
              {(() => {
                let contentIdx = 0;
                return nodes.map((node) => (
                <NodeItem
                  key={node.id}
                  node={node}
                  contentIndex={node.type !== 'FOLDER' && node.contentItemId ? ++contentIdx : null}
                  isSelected={selectedNodeId === node.id}
                  isDragging={draggedNodeId === node.id}
                  dropTarget={dropTarget}
                  onSelect={onSelect}
                  onEnterFolder={onEnterFolder}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                />
              ));
              })()}
            </div>
          )}
        </ContentFade>
      </div>

      {/* Bottom actions */}
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
        <button
          className="hover-shelf flex items-center gap-1 rounded px-1.5 py-0.5 text-base font-medium transition-colors duration-150"
          style={{ color: 'var(--ink)' }}
          onClick={() => onAddChild(currentParentId)}
        >
          <Plus size={10} strokeWidth={2} />
          新建
        </button>
      </div>
    </aside>
  );
}
