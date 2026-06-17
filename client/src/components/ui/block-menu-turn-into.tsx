/**
 * BlockMenuTurnInto — 块菜单的 Turn into 子菜单
 *
 * 设计：列出当前块可转的目标类型；点击调 setBlockType。
 * 当前块类型对应的项打勾。
 */
'use client';

import { KEYS } from 'platejs';
import { useEditorRef } from 'platejs/react';
import type { Path } from 'platejs';
import {
  Heading1Icon, Heading2Icon, Heading3Icon,
  PilcrowIcon, QuoteIcon, ListIcon, ListOrderedIcon, CheckSquareIcon, Code2Icon,
} from 'lucide-react';

import { setBlockType } from '@/components/editor/transforms';

type TurnIntoItem = { type: string; label: string; Icon: typeof Heading1Icon };

// 可转目标。表格 / 公式 / 图片 / 视频块不在列表里（这些块不出现 Turn into）
const ITEMS: TurnIntoItem[] = [
  { type: KEYS.p,          label: '段落',     Icon: PilcrowIcon },
  { type: KEYS.h1,         label: '标题 1',   Icon: Heading1Icon },
  { type: KEYS.h2,         label: '标题 2',   Icon: Heading2Icon },
  { type: KEYS.h3,         label: '标题 3',   Icon: Heading3Icon },
  { type: KEYS.blockquote, label: '引用',     Icon: QuoteIcon },
  { type: KEYS.ul,         label: '无序列表', Icon: ListIcon },
  { type: KEYS.ol,         label: '有序列表', Icon: ListOrderedIcon },
  { type: KEYS.listTodo,   label: '待办',     Icon: CheckSquareIcon },
  { type: KEYS.codeBlock,  label: '代码块',   Icon: Code2Icon },
];

interface Props {
  blockPath: Path;
  currentType: string;
  onPicked: () => void;
}

export function BlockMenuTurnInto({ blockPath, currentType, onPicked }: Props) {
  const editor = useEditorRef();

  return (
    <div className="flex flex-col gap-px p-1">
      {ITEMS.map(({ type, label, Icon }) => {
        const isCurrent = type === currentType;
        return (
          <button
            key={type}
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-overlay)]"
            style={{ color: 'var(--ink)' }}
            onClick={() => {
              setBlockType(editor, type, { at: blockPath });
              onPicked();
            }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="flex-1">{label}</span>
            {isCurrent && <span className="text-xs opacity-60">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
