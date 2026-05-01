'use client';

import * as React from 'react';

import { useDraggable, useDropLine } from '@platejs/dnd';
import { GripVertical } from 'lucide-react';
import { getPluginByType, isType, KEYS } from 'platejs';
import {
  type PlateElementProps,
  type RenderNodeWrapper,
  MemoizedChildren,
} from 'platejs/react';

import { cn } from '@/lib/utils';

const UNDRAGGABLE_KEYS = [KEYS.tr, KEYS.td];

/**
 * 块级拖拽包装器 — 每个顶层块左侧显示拖拽手柄，
 * 拖放时显示蓝色指示线。
 */
export const BlockDraggable: RenderNodeWrapper = (props) => {
  const { editor, element, path } = props;

  /* 只允许顶层块拖拽（depth=1），排除表格行/单元格 */
  const enabled =
    !editor.dom.readOnly &&
    path.length === 1 &&
    !isType(editor, element, UNDRAGGABLE_KEYS);

  if (!enabled) return;

  return (props) => <Draggable {...props} />;
};

function Draggable({ children, editor, element }: PlateElementProps) {
  const { isDragging, nodeRef, handleRef } = useDraggable({ element });

  return (
    <div
      className={cn(
        'group relative',
        isDragging && 'opacity-50',
        getPluginByType(editor, element.type)?.node.isContainer &&
          'group/container',
      )}
    >
      {/* 拖拽手柄 — hover 时显示 */}
      <div
        className="absolute top-0 -translate-x-full pr-1 opacity-0 transition-opacity group-hover:opacity-100"
        contentEditable={false}
      >
        <button
          ref={handleRef}
          className="flex h-6 w-4 cursor-grab items-center justify-center rounded active:cursor-grabbing"
          data-plate-prevent-deselect
        >
          <GripVertical className="size-3.5 text-muted-foreground" />
        </button>
      </div>

      <div ref={nodeRef} className="flow-root">
        <MemoizedChildren>{children}</MemoizedChildren>
        <DropLine />
      </div>
    </div>
  );
}

const DropLine = React.memo(function DropLine() {
  const { dropLine } = useDropLine();

  if (!dropLine) return null;

  return (
    <div
      className={cn(
        'absolute inset-x-0 h-0.5 bg-brand/50',
        dropLine === 'top' && '-top-px',
        dropLine === 'bottom' && '-bottom-px',
      )}
    />
  );
});
