/**
 * BlockMenu — 行块 hover ⋮⋮ 菜单的浮层
 *
 * 设计：
 *   - Radix Popover，自带 collision 翻面 + 锁焦点
 *   - 顶层项：转换成 / 复制 / 在上方插入 / 在下方插入 / 删除块
 *   - 转换成是 Popover 二级：就地替换 content；通过 AnimatePresence 做 slide-x + opacity 转场
 *   - 二级视图顶部带返回按钮，回到一级
 *   - open 状态支持 controlled（让外层 wrapper 据此整块高亮），未传时走 internal state
 * 颜色说明：删除按钮用 var(--danger)（项目中等价 --ink-warn，源于 --mark-red）
 */
'use client';

import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GripVerticalIcon,
  TrashIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Path, TElement } from 'platejs';
import { useEditorRef } from 'platejs/react';

import { getBlockType } from '@/components/editor/transforms';
import { BlockMenuTurnInto } from './block-menu-turn-into';

interface Props {
  blockPath: Path;
  blockNode: TElement;
  /** 受控 open：外层 wrapper 据此整块高亮，未传时走 internal state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// 动画曲线：缓出（开始快、结尾轻），更"高级"感
const EASE_OUT = [0.32, 0.72, 0, 1] as const;
const DURATION = 0.16;

// 菜单项共用样式
const ITEM_CLS =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]';

/** 单行菜单按钮 — icon + label + 可选右侧 chevron */
function MenuItem({
  icon: Icon,
  label,
  color = 'var(--ink)',
  trailingIcon: TrailingIcon,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  color?: string;
  trailingIcon?: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={ITEM_CLS}
      style={{ color }}
      onClick={onClick}
    >
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
      <span className="flex-1">{label}</span>
      {TrailingIcon && <TrailingIcon className="h-3.5 w-3.5" strokeWidth={1.5} />}
    </button>
  );
}

export function BlockMenu({
  blockPath,
  blockNode,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const editor = useEditorRef();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const [view, setView] = useState<'main' | 'turnInto'>('main');
  const currentType = getBlockType(blockNode);

  const close = () => {
    setOpen(false);
    // 关闭时回到主视图，下次打开是 main 起手
    setView('main');
  };

  /* 每个 handler 先 editor.tf.focus() 再 transform：popover 打开时焦点
   * 跑去 popover 内部 button，PlateEditor.setBody 的 isUserEdit 判断会
   * 看 document.activeElement 是否在 [data-slate-editor] 内 — 不在 →
   * 返回 false → 不 setIsDirty(true) → 不触发自动保存。块菜单的
   * 转换 / 复制 / 插入 / 删除如果不先把焦点还给编辑器，所有改动都
   * 不会落盘（用户刷新后内容回到上次保存版本，看似"自动保存挂了"）。 */
  const handleDuplicate = () => {
    editor.tf.focus();
    const cloned = structuredClone(blockNode);
    const nextPath = [...blockPath];
    nextPath[nextPath.length - 1] = (nextPath[nextPath.length - 1] as number) + 1;
    editor.tf.insertNodes(cloned, { at: nextPath as Path });
    close();
  };

  const handleDelete = () => {
    editor.tf.focus();
    editor.tf.removeNodes({ at: blockPath });
    close();
  };

  const handleInsertAbove = () => {
    editor.tf.focus();
    editor.tf.insertNodes({ type: 'p', children: [{ text: '' }] } as TElement, {
      at: blockPath,
    });
    close();
  };

  const handleInsertBelow = () => {
    editor.tf.focus();
    const nextPath = [...blockPath];
    nextPath[nextPath.length - 1] = (nextPath[nextPath.length - 1] as number) + 1;
    editor.tf.insertNodes(
      { type: 'p', children: [{ text: '' }] } as TElement,
      { at: nextPath as Path },
    );
    close();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="块菜单"
          /* hover affordance：用 ink-ghost + opacity-0 → group-hover/focus 显形 */
          className="block-hover-handle flex h-6 w-5 items-center justify-center rounded opacity-0 transition-opacity duration-150 hover:bg-[var(--hover-overlay)] focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
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
          /* overflow-hidden：slide 过渡时切边不溢出圆角 */
          className="z-[var(--z-dropdown)] min-w-[180px] overflow-hidden rounded-xl border border-[var(--separator)] bg-popover p-0 shadow-[0_4px_14px_rgba(0,0,0,.06),0_18px_44px_rgba(0,0,0,.14)]"
        >
          {/*
            AnimatePresence + mode="wait"：上一个视图先 exit 再让下一个 enter，避免重叠期 popover 高度抖动。
            动画方向约定：main 永远在左，turnInto 永远在右——
              前进（main→turnInto）：main 向左走 + turnInto 从右来
              返回（turnInto→main）：turnInto 向右走 + main 从左来
            视觉上像翻页。位移 30% 而非 100%，配合 opacity 出，比"硬 slap"高级。
          */}
          <AnimatePresence mode="wait" initial={false}>
            {view === 'main' ? (
              <motion.div
                key="main"
                initial={{ x: '-30%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '-30%', opacity: 0 }}
                transition={{ duration: DURATION, ease: EASE_OUT }}
                className="flex flex-col gap-px p-1"
              >
                <MenuItem label="转换成" trailingIcon={ChevronRightIcon} onClick={() => setView('turnInto')} />
                <MenuItem icon={CopyIcon} label="复制" onClick={handleDuplicate} />
                <MenuItem icon={ArrowUpIcon} label="在上方插入" onClick={handleInsertAbove} />
                <MenuItem icon={ArrowDownIcon} label="在下方插入" onClick={handleInsertBelow} />
                {/* 删除操作用 danger 色（即 --mark-red），项目中无 --ink-warn，用 --danger 替代 */}
                <MenuItem icon={TrashIcon} label="删除块" color="var(--danger)" onClick={handleDelete} />
              </motion.div>
            ) : (
              <motion.div
                key="turnInto"
                initial={{ x: '30%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '30%', opacity: 0 }}
                transition={{ duration: DURATION, ease: EASE_OUT }}
              >
                {/* 返回按钮：回到主视图（不关闭 popover） */}
                <div className="flex flex-col gap-px p-1">
                  <MenuItem
                    icon={ChevronLeftIcon}
                    label="返回"
                    color="var(--ink-ghost)"
                    onClick={() => setView('main')}
                  />
                </div>
                {/* 分隔线 */}
                <div className="mx-1 h-px bg-[var(--separator)]" />
                <BlockMenuTurnInto
                  blockPath={blockPath}
                  currentType={currentType}
                  onPicked={close}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
