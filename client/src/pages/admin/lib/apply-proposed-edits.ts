/**
 * applyProposedEdits —— 把 AI 的查找-替换块落成编辑器 suggestion 痕迹。
 *
 * 流程:
 *   1. 用 findBlockByText 在顶层块里精确定位 find 所在块(唯一命中)
 *   2. 块内文本替换 find→replace 得到新文本
 *   3. deserializeMd 将新文本转成 Slate 节点树
 *   4. diffToSuggestions(旧块, 新块) 生成带 suggestion mark 的节点数组
 *   5. removeNodes + insertNodes 将旧块替换为带痕迹的新块
 *
 * 失败的 edit 不抛异常,只记入 outcomes 供聊天卡片标红。
 * 只对命中块做 diff(避免整篇 O(n²))。
 *
 * 注:replaceNodes 在 @platejs/slate v53 的 EditorTransforms 中不存在,
 * 用 removeNodes + insertNodes 组合实现等效语义。
 */

import type { PlateEditor } from 'platejs/react';
import { deserializeMd } from '@platejs/markdown';
import { diffToSuggestions } from '@platejs/suggestion';

import { findBlockByText } from './find-block-by-text';

export interface ProposedEdit {
  find: string;
  replace: string;
  reason: string;
}

/** 每处 edit 的应用结果,供聊天卡片汇报(成功/为何失败) */
export type EditOutcome =
  | { edit: ProposedEdit; ok: true; blockIndex: number }
  | { edit: ProposedEdit; ok: false; reason: 'not-found' | 'not-unique' };

export function applyProposedEdits(editor: PlateEditor, edits: ProposedEdit[]): EditOutcome[] {
  const outcomes: EditOutcome[] = [];

  // outcomes 与 edits 等长一一对应(失败项 ok=false 而非跳过),供卡片按下标标红
  for (const edit of edits) {
    // Step 1: 定位 find 所在块,要求全文唯一
    const found = findBlockByText(editor.children, edit.find);
    if (!found.ok) {
      if (import.meta.env.DEV) {
        console.warn(
          `[applyProposedEdits] 定位失败 reason=${found.reason} find长度=${edit.find.length}`,
        );
      }
      outcomes.push({ edit, ok: false, reason: found.reason });
      continue;
    }

    const { blockIndex, blockText, matchedNeedle } = found;
    const oldBlock = editor.children[blockIndex];

    // Step 2: 块内文本替换 matchedNeedle→replace。
    // matchedNeedle ≠ edit.find 的情况：findBlockByText 已剥掉行首 markdown 标记（如 "# "、"- "）
    // 才命中的；如果在 blockText 里用原 edit.find 做 replace，纯文本里没那个前缀，replace 会无效返回原文。
    const newText = blockText.replace(matchedNeedle, edit.replace);

    // Step 3: 将新文本反序列化为 Slate 节点树
    const newBlocks = deserializeMd(editor, newText);

    // Step 4: diffToSuggestions 生成带 suggestion mark 的节点数组
    // 传 [oldBlock] vs newBlocks(对单块做 diff,不做全文 diff)
    //
    // ignoreProps: ['id'] —— 关键修复(踩坑见下):
    //   diffToSuggestions → computeDiff 用 childrenOnlyStrategy 判断两个块是否"只改了
    //   children"——条件是两块除 children 外所有属性 isEqual。usePlateEditor 默认装了
    //   NodeIdPlugin,编辑器里每个块都带稳定 id;而 deserializeMd 产出的新块【没有 id】。
    //   id 不等 → childrenOnlyStrategy 判否 → 退化成【整块删除 + 整块插入】:suggestion
    //   数据挂到 paragraph element 上(块级),而非 text leaf 上(行内),于是渲染成
    //   "整段旧文+整段新文两段并排、无红绿删除线"(SuggestionLeaf 是 leaf 渲染器,块级
    //   数据它读不到)。把 id 列入 ignoreProps,让 diff 忽略 id 差异 → 判为同块更新 →
    //   递归 diff children → 产出【行内 leaf 级】增删痕迹,SuggestionLeaf 才能上色。
    const suggested = diffToSuggestions(editor, [oldBlock], newBlocks, {
      ignoreProps: ['id'],
    });

    // Step 5: 先移除旧块,再在同位置插入带痕迹的新节点
    // EditorTransforms v53 不提供 replaceNodes,用 remove+insert 组合替代
    editor.tf.removeNodes({ at: [blockIndex] });
    editor.tf.insertNodes(suggested, { at: [blockIndex] });

    if (import.meta.env.DEV) {
      console.debug(`[applyProposedEdits] 已落 suggestion blockIndex=${blockIndex}`);
    }

    outcomes.push({ edit, ok: true, blockIndex });
  }

  return outcomes;
}
