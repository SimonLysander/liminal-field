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
 *   - 表格 / 公式 / 图片 / 附件 / 分割线：这些块的 children 结构、
 *     void 语义或插件状态与普通文本块不同，不暴露 Turn into。
 *     需要替换内容时走删除 + 插入，避免 setNodes({ type }) 把节点
 *     结构改坏。
 *
 * 当前块类型对应的项打勾。
 */
'use client';

import { KEYS } from 'platejs';
import { unwrapCodeBlock } from '@platejs/code-block';
import { useEditorRef } from 'platejs/react';
import type { Path } from 'platejs';

import { setBlockType } from '@/components/editor/transforms';
import { getTurnIntoItems } from '@/components/editor/block-conversion';

interface Props {
  blockPath: Path;
  currentType: string;
  onPicked: () => void;
}

export function BlockMenuTurnInto({ blockPath, currentType, onPicked }: Props) {
  const editor = useEditorRef();
  const items = getTurnIntoItems(currentType);

  if (items.length === 0) {
    return null;
  }

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
