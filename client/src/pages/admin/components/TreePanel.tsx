/*
 * TreePanel — Admin content structure sidebar (Apple Books style)
 *
 * Design decisions:
 *   - Floating card pattern: matches display Sidebar — sidebar-bg (#F2F2F2),
 *     margin 8px, radius-lg (10px), shadow-sm. Both sidebars are 200px wide.
 *   - Lucide icons: ChevronRight (animated rotate 0→90° on expand), Folder,
 *     FileText, RefreshCw, Plus — consistent with display Sidebar icon style.
 *   - Tree indentation: depth * 14px marginLeft per level, keeping the tree
 *     compact within the 200px panel.
 *   - Node items use rounded-[10px] (radius-lg tier) for hover/selected states.
 *   - Drag-and-drop reordering: three-zone drop detection for folders
 *     (top 25% = before, middle 50% = inside, bottom 25% = after), two-zone
 *     for documents (top/bottom half = before/after).
 *   - Hover actions (add/edit/delete) appear on group-hover with opacity
 *     transition for a non-intrusive UX.
 *   - All font sizes use CSS type scale variables (--text-sm, --text-2xs, etc.)
 *     for consistency with the global design system.
 */

import { useCallback, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Folder, FileText, RefreshCw, Plus } from 'lucide-react';
import type { TreeNode } from '../types';

/* ---------- Drop position types ---------- */

type DropPosition = 'before' | 'after' | 'inside';

type DropTarget = {
  nodeId: string;
  position: DropPosition;
};

/* ---------- Tree node item ---------- */

const TreeNodeItem = ({
  node,
  depth,
  selectedNodeId,
  draggedNodeId,
  dropTarget,
  onSelect,
  onExpand,
  onAddChild,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  node: TreeNode;
  depth: number;
  selectedNodeId: string | null;
  draggedNodeId: string | null;
  dropTarget: DropTarget | null;
  onSelect: (node: TreeNode) => void;
  onExpand: (node: TreeNode) => void;
  onAddChild: (parentId?: string) => void;
  onEdit: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onDragStart: (nodeId: string) => void;
  onDragOver: (e: React.DragEvent, nodeId: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}) => {
  const isFolder = node.type === 'FOLDER';
  const isSelected = selectedNodeId === node.id;
  const isDragging = draggedNodeId === node.id;
  const isDropTarget = dropTarget?.nodeId === node.id;

  return (
    <div style={{ opacity: isDragging ? 0.4 : 1 }}>
      {/* Before drop indicator */}
      {isDropTarget && dropTarget.position === 'before' && (
        <div
          style={{
            height: 2,
            background: 'var(--mark-blue)',
            marginLeft: depth * 16 + 12,
            marginRight: 8,
            borderRadius: 1,
          }}
        />
      )}

      <div
        className="group flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-[7px] transition-all duration-150"
        style={{
          marginLeft: `${depth * 14}px`,
          background: isDropTarget && dropTarget.position === 'inside'
            ? 'rgba(10,132,255,0.1)'
            : isSelected
              ? 'var(--shelf)'
              : 'transparent',
          color: isSelected ? 'var(--ink)' : 'var(--ink-faded)',
          outline: isDropTarget && dropTarget.position === 'inside'
            ? '1.5px dashed var(--mark-blue)'
            : 'none',
          outlineOffset: -1,
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
        onClick={() => onSelect(node)}
      >
        {/* Icon — folder with chevron, or file icon */}
        {isFolder ? (
          <button
            className="flex shrink-0 items-center gap-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onExpand(node);
            }}
          >
            {node.isLoading ? (
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-ghost)' }}>···</span>
            ) : (
              <motion.span
                className="flex items-center"
                animate={{ rotate: node.isExpanded ? 90 : 0 }}
                transition={{ duration: 0.15 }}
              >
                <ChevronRight size={12} strokeWidth={2} style={{ color: 'var(--ink-ghost)' }} />
              </motion.span>
            )}
            <Folder size={14} strokeWidth={1.5} style={{ color: isSelected ? 'var(--ink)' : 'var(--ink-ghost)' }} />
          </button>
        ) : (
          <FileText size={14} strokeWidth={1.5} className="shrink-0" style={{ color: isSelected ? 'var(--ink)' : 'var(--ink-ghost)' }} />
        )}

        <span
          className="min-w-0 flex-1 truncate"
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: isSelected ? 500 : 400,
          }}
        >
          {node.name}
        </span>

        {/* Hover actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          {isFolder && (
            <button
              className="rounded-md p-0.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
            >
              <Plus size={12} strokeWidth={2} />
            </button>
          )}
          <button
            className="rounded-md px-1 py-0.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}
            onClick={(e) => { e.stopPropagation(); onEdit(node); }}
          >
            ✎
          </button>
          <button
            className="rounded-md px-1 py-0.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--mark-red)', fontSize: 'var(--text-2xs)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
          >
            ×
          </button>
        </div>
      </div>

      {/* After drop indicator */}
      {isDropTarget && dropTarget.position === 'after' && (
        <div
          style={{
            height: 2,
            background: 'var(--mark-blue)',
            marginLeft: depth * 16 + 12,
            marginRight: 8,
            borderRadius: 1,
          }}
        />
      )}

      {node.isExpanded && node.children && (
        <div>
          {node.children.length === 0 ? (
            <p
              className="py-1"
              style={{
                paddingLeft: `${(depth + 1) * 14 + 30}px`,
                color: 'var(--ink-ghost)',
                fontSize: 'var(--text-xs)',
              }}
            >
              暂无内容
            </p>
          ) : (
            node.children.map((child) => (
              <TreeNodeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedNodeId={selectedNodeId}
                draggedNodeId={draggedNodeId}
                dropTarget={dropTarget}
                onSelect={onSelect}
                onExpand={onExpand}
                onAddChild={onAddChild}
                onEdit={onEdit}
                onDelete={onDelete}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ---------- Main panel ---------- */

export const TreePanel = ({
  tree,
  loading,
  error,
  selectedNodeId,
  totalNodes,
  onReload,
  onSelect,
  onExpand,
  onAddChild,
  onEdit,
  onDelete,
  onMoveNode,
}: {
  tree: TreeNode[];
  loading: boolean;
  error: string;
  selectedNodeId: string | null;
  totalNodes: number;
  onReload: () => Promise<void>;
  onSelect: (node: TreeNode) => void;
  onExpand: (node: TreeNode) => void;
  onAddChild: (parentId?: string) => void;
  onEdit: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onMoveNode: (nodeId: string, targetNodeId: string, position: DropPosition) => void;
}) => {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragOverCountRef = useRef(0);

  const handleDragStart = useCallback((nodeId: string) => {
    setDraggedNodeId(nodeId);
    dragOverCountRef.current = 0;
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
      const height = rect.height;

      /* Determine drop position based on cursor Y within the element */
      let position: DropPosition;
      const node = findNodeInTree(tree, nodeId);
      const isFolder = node?.type === 'FOLDER';

      if (isFolder) {
        /* Folders have three zones: top 25% = before, middle 50% = inside, bottom 25% = after */
        if (y < height * 0.25) position = 'before';
        else if (y > height * 0.75) position = 'after';
        else position = 'inside';
      } else {
        /* Non-folders: top half = before, bottom half = after */
        position = y < height * 0.5 ? 'before' : 'after';
      }

      setDropTarget({ nodeId, position });
    },
    [draggedNodeId, tree],
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

      if (isDescendant(tree, draggedNodeId, dropTarget.nodeId)) {
        handleDragEnd();
        return;
      }
      onMoveNode(draggedNodeId, dropTarget.nodeId, dropTarget.position);
      handleDragEnd();
    },
    [draggedNodeId, dropTarget, tree, onMoveNode, handleDragEnd],
  );

  return (
    <aside
      className="flex w-[200px] shrink-0 flex-col overflow-hidden"
      style={{
        background: 'var(--sidebar-bg)',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-1">
        <div
          className="font-semibold"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-base)', letterSpacing: '-0.01em' }}
        >
          内容管理
        </div>
        <div className="mt-1" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}>
          {totalNodes} 个节点
        </div>
      </div>

      {/* Section label */}
      <div
        className="mt-4 px-5 pb-2 font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.06em' }}
      >
        结构
      </div>

      {/* Tree list */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {loading && tree.length === 0 ? (
          <div className="px-3 py-8 text-center" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
            加载中...
          </div>
        ) : error ? (
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>{error}</p>
            <button
              className="mt-2 font-medium transition-colors duration-150"
              style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-xs)' }}
              onClick={() => void onReload()}
            >
              重试
            </button>
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-8 text-center" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
            暂无节点
          </div>
        ) : (
          tree.map((node) => (
            <TreeNodeItem
              key={node.id}
              node={node}
              depth={0}
              selectedNodeId={selectedNodeId}
              draggedNodeId={draggedNodeId}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onExpand={onExpand}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
            />
          ))
        )}
      </div>

      {/* Bottom actions */}
      <div
        className="flex items-center justify-between px-5 pb-4"
        style={{ marginTop: 12, paddingTop: 12 }}
      >
        <button
          className="flex items-center gap-1.5 transition-colors duration-150"
          style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-xs)' }}
          onClick={() => void onReload()}
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          刷新
        </button>
        <button
          className="flex items-center gap-1 font-medium transition-colors duration-150"
          style={{ color: 'var(--ink)', fontSize: 'var(--text-xs)' }}
          onClick={() => onAddChild()}
        >
          <Plus size={12} strokeWidth={2} />
          新建
        </button>
      </div>
    </aside>
  );
};

/* ---------- Tree helpers ---------- */

function findNodeInTree(tree: TreeNode[], id: string): TreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** 判断 descendantId 是否位于 ancestorId 的子树中（含自身相等的情况） */
function isDescendant(tree: TreeNode[], ancestorId: string, descendantId: string): boolean {
  if (ancestorId === descendantId) return true;
  const ancestor = findNodeInTree(tree, ancestorId);
  if (!ancestor?.children) return false;
  return ancestor.children.some((child) => isDescendant(tree, child.id, descendantId));
}
