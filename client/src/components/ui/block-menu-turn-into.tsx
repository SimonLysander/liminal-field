/**
 * BlockMenuTurnInto — 块菜单的 Turn into 子菜单
 *
 * 设计：根据当前块类型动态过滤可转目标，避免不安全互转。
 *
 *   - 文本类（段落/H1-H3/引用）+ 列表类（无序/有序/待办）：
 *     8 项互通。children 都是 inline text + listType 字段切换即可，
 *     setBlockType 安全。
 *
 *   - 代码块：内部是 CodeLine + CodeSyntax 子树，跟其他块结构完全
 *     不同；段落 → 代码块或反向都会丢内容/格式。代码块当前块时
 *     只暴露"段落"作为安全退路（让用户能脱出代码块结构）；其他
 *     块时不出现"转代码块"选项。
 *     想插代码块：走 / 命令菜单 或 ``` 输入规则。
 *
 *   - 表格 / 公式 / 图片 / 视频：块菜单的 path.length === 1 守卫已
 *     过滤掉这些复杂顶层块的子结构，但顶层图片块仍会带块菜单（含
 *     转换成）。这里依然只显示安全的 8 项，让用户能把"图片块"
 *     当容器替换成段落属于另一类需求，本设计暂不暴露。
 *
 * 当前块类型对应的项打勾。
 */
'use client';

import { KEYS } from 'platejs';
import { useEditorRef } from 'platejs/react';
import type { Path } from 'platejs';
import {
  Heading1Icon, Heading2Icon, Heading3Icon,
  PilcrowIcon, QuoteIcon, ListIcon, ListOrderedIcon, CheckSquareIcon,
} from 'lucide-react';

import { setBlockType } from '@/components/editor/transforms';

type TurnIntoItem = { type: string; label: string; Icon: typeof Heading1Icon };

// 文本 + 列表 — 这 8 项互转安全
const TEXT_AND_LIST_ITEMS: TurnIntoItem[] = [
  { type: KEYS.p,          label: '段落',     Icon: PilcrowIcon },
  { type: KEYS.h1,         label: '标题 1',   Icon: Heading1Icon },
  { type: KEYS.h2,         label: '标题 2',   Icon: Heading2Icon },
  { type: KEYS.h3,         label: '标题 3',   Icon: Heading3Icon },
  { type: KEYS.blockquote, label: '引用',     Icon: QuoteIcon },
  { type: KEYS.ul,         label: '无序列表', Icon: ListIcon },
  { type: KEYS.ol,         label: '有序列表', Icon: ListOrderedIcon },
  { type: KEYS.listTodo,   label: '待办',     Icon: CheckSquareIcon },
];

// 代码块的退路：只允许 → 段落
const CODE_BLOCK_ESCAPE_ITEMS: TurnIntoItem[] = [
  { type: KEYS.p, label: '段落', Icon: PilcrowIcon },
];

interface Props {
  blockPath: Path;
  currentType: string;
  onPicked: () => void;
}

export function BlockMenuTurnInto({ blockPath, currentType, onPicked }: Props) {
  const editor = useEditorRef();
  const items =
    currentType === KEYS.codeBlock
      ? CODE_BLOCK_ESCAPE_ITEMS
      : TEXT_AND_LIST_ITEMS;

  return (
    <div className="flex flex-col gap-px p-1">
      {items.map(({ type, label, Icon }) => {
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
