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
 *     不同。当前块是代码块时只暴露"段落"作为退路，实现走
 *     @platejs/code-block 官方导出的 unwrapCodeBlock —— 每行
 *     code_line 转 paragraph，自动保留换行和 inline 结构。其他
 *     块时不出现"转代码块"选项，想插代码块走 / 命令菜单 或 ```。
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
import { unwrapCodeBlock } from '@platejs/code-block';
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

// 代码块的退路：只暴露"段落"。其他块型（标题/列表/引用）从代码块直转
// 仍然是结构跨度太大的边界场景，先不开。
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
              // 先 focus 编辑器，让 PlateEditor.setBody 的 isUserEdit 判断通过
              editor.tf.focus();

              // 代码块 → 段落：走 @platejs/code-block 官方的 unwrapCodeBlock。
              //   实现逻辑（看包源码）：每个 code_line → setNodes({type:p}) +
              //   unwrapNodes(code_block 容器, split:true)。Slate 原生
              //   transform，自动保留每行 inline 文本结构、保留换行（"换行"
              //   等于"行块"之间的边界）、不影响相邻块。
              //   官方按 editor.selection 定位代码块，所以先 select 到 blockPath
              //   起点，让 unwrap 精确命中目标块。
              //   之前手写 NodeApi.string(整块).split('\n') + 整块替换 翻车过
              //   两次（拍平相邻段落 / 丢换行），现在切回官方 API。
              if (currentType === KEYS.codeBlock && type === KEYS.p) {
                const start = editor.api.start(blockPath);
                if (start) editor.tf.select(start);
                unwrapCodeBlock(editor);
                onPicked();
                return;
              }

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
