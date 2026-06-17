/**
 * BlockMenu — 行块 hover ⋮⋮ 菜单的浮层
 *
 * 设计：
 *   - Radix Popover，自带 collision 翻面 + 锁焦点
 *   - 顶层项：Turn into / Duplicate / Insert above / Insert below / Delete
 *   - Turn into 是 Popover 二级（点开换 content）
 * 颜色说明：删除按钮用 var(--danger)（项目中等价 --ink-warn，源于 --mark-red）
 */
'use client';

import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  GripVerticalIcon,
  ChevronRightIcon,
  CopyIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from 'lucide-react';
import type { Path, TElement } from 'platejs';
import { useEditorRef } from 'platejs/react';

import type { PlateElementProps } from 'platejs/react';

import { getBlockType } from '@/components/editor/transforms';
import { BlockMenuTurnInto } from './block-menu-turn-into';

interface Props {
  blockPath: Path;
  blockNode: TElement;
}

/**
 * BlockMenuNodeWrapper — 顶层块的 group 外壳，供 block-menu-kit.ts 的 aboveNodes 回调使用。
 * 接受固定的 blockPath / blockNode，返回一个渲染函数（符合 RenderNodeWrapperFunction 签名）。
 */
export function createBlockMenuNodeWrapper(blockPath: Path, blockNode: TElement) {
  return function BlockMenuNodeWrapperInner({ children }: PlateElementProps) {
    return (
      <div className="group relative">
        {/* 定位到块左侧，contentEditable=false 避免编辑器把点击当文本操作 */}
        <div
          className="absolute -left-7 top-1 select-none"
          contentEditable={false}
        >
          <BlockMenu blockPath={blockPath} blockNode={blockNode} />
        </div>
        {children}
      </div>
    );
  };
}

export function BlockMenu({ blockPath, blockNode }: Props) {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'turnInto'>('main');
  const currentType = getBlockType(blockNode);

  const close = () => {
    setOpen(false);
    setView('main');
  };

  const handleDuplicate = () => {
    const cloned = structuredClone(blockNode);
    const nextPath = [...blockPath];
    nextPath[nextPath.length - 1] = (nextPath[nextPath.length - 1] as number) + 1;
    editor.tf.insertNodes(cloned, { at: nextPath as Path });
    close();
  };

  const handleDelete = () => {
    editor.tf.removeNodes({ at: blockPath });
    close();
  };

  const handleInsertAbove = () => {
    editor.tf.insertNodes({ type: 'p', children: [{ text: '' }] } as TElement, { at: blockPath });
    close();
  };

  const handleInsertBelow = () => {
    const nextPath = [...blockPath];
    nextPath[nextPath.length - 1] = (nextPath[nextPath.length - 1] as number) + 1;
    editor.tf.insertNodes(
      { type: 'p', children: [{ text: '' }] } as TElement,
      { at: nextPath as Path }
    );
    close();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="块菜单"
          /* 设计系统：hover affordance — 用 ink-tertiary（ink-ghost）+ 略弱透明度 */
          className="block-hover-handle flex h-6 w-5 items-center justify-center rounded opacity-0 transition-opacity duration-150 hover:bg-[var(--hover-overlay)] focus:opacity-100 group-hover:opacity-100"
          style={{ color: 'var(--ink-ghost)' }}
          /* 阻止 mousedown 抢编辑器焦点 */
          onMouseDown={(e) => e.preventDefault()}
        >
          <GripVerticalIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[var(--z-dropdown)] min-w-[180px] rounded-xl border border-[var(--separator)] bg-popover p-0 shadow-[0_4px_14px_rgba(0,0,0,.06),0_18px_44px_rgba(0,0,0,.14)]"
        >
          {view === 'main' ? (
            <div className="flex flex-col gap-px p-1">
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
                style={{ color: 'var(--ink)' }}
                onClick={() => setView('turnInto')}
              >
                <span className="flex-1">Turn into</span>
                <ChevronRightIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
                style={{ color: 'var(--ink)' }}
                onClick={handleDuplicate}
              >
                <CopyIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="flex-1">复制</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
                style={{ color: 'var(--ink)' }}
                onClick={handleInsertAbove}
              >
                <ArrowUpIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="flex-1">在上方插入</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
                style={{ color: 'var(--ink)' }}
                onClick={handleInsertBelow}
              >
                <ArrowDownIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="flex-1">在下方插入</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
                /* 删除操作用 danger 色（即 --mark-red），项目中无 --ink-warn，用 --danger 替代 */
                style={{ color: 'var(--danger)' }}
                onClick={handleDelete}
              >
                <TrashIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="flex-1">删除块</span>
              </button>
            </div>
          ) : (
            <BlockMenuTurnInto
              blockPath={blockPath}
              currentType={currentType}
              onPicked={close}
            />
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
