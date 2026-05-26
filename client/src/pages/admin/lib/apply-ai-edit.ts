/**
 * applyAiEdit —— v2 改稿落地:自用 @platejs/suggestion 的 diffToSuggestions 拼 diff 流程。
 *
 * ⚠️ 为什么彻底弃用 @platejs/ai(applyAISuggestions / AIChatPlugin / AIPlugin)?
 *
 * applyAISuggestions 内部调 editor.setOption(AIChatPlugin, 'chatNodes', ...) 的实现路径
 * 在本项目环境下持续抛 `Cannot read properties of undefined (reading 'set')`。
 * 根因是多重深层问题叠加(plugin 注册时序 / Vite HMR 双加载 / 对象引用不一致),
 * 没有单一表面补丁能根治。尝试改用 getEditorPlugin({ key: 'aiChat' }) 字符串查找绕过、
 * 保证 EditorKit 里只注册一次 AIPlugin/AIChatPlugin 等,均治标不治本。
 *
 * 根治方案 = 完全不碰 @platejs/ai:
 *   - 自己调 diffToSuggestions(editor, oldNodes, newNodes, { ignoreProps:['id'] })
 *   - diffToSuggestions 是 @platejs/suggestion 的公开 API,v1 改稿(apply-proposed-edits)
 *     里已用过、行为稳定、ignoreProps 踩坑也已记录(CLAUDE.md)。
 *
 * 两场景:
 * - rewrite_selection:取锚点指向的块作为 oldNodes,deserializeMd 解析 newMarkdown 为
 *   newNodes,diffToSuggestions 产 suggestion 痕迹,然后用 removeNodes+insertNodes 替换该块。
 * - rewrite_document:整篇 diff。editor.tf.setValue(suggested) 一次性替换全文档。
 *
 * 失败兜底:
 * - rewrite_selection 但无 range 锚点 → no-anchor 不动编辑器
 * - markdown 解析 / transform 抛错 → parse-error
 * 失败 outcome 由上层卡片标红展示。
 */

import type { Descendant, Value } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { diffToSuggestions } from '@platejs/suggestion';
import { deserializeMd } from '@platejs/markdown';

import type { AnchorPayload } from './serialize-anchor';

export type AiEditTool = 'rewrite_selection' | 'rewrite_document';

export type AiEditOutcome =
  | { ok: true; tool: AiEditTool }
  | { ok: false; tool: AiEditTool; reason: 'no-anchor' | 'parse-error' };

export function applyAiEdit(
  editor: PlateEditor,
  tool: AiEditTool,
  newMarkdown: string,
  anchor: AnchorPayload,
): AiEditOutcome {
  try {
    if (tool === 'rewrite_selection') {
      // rewrite_selection 要求有 range 锚点才知道改哪个块
      if (anchor.type !== 'range') {
        if (import.meta.env.DEV) {
          console.warn('[ai-edit] rewrite_selection 但无 range 锚点,跳过');
        }
        return { ok: false, tool, reason: 'no-anchor' };
      }

      const blockIndex = anchor.blockIndex ?? 0;
      const oldBlock = editor.children[blockIndex];
      if (!oldBlock) {
        return { ok: false, tool, reason: 'no-anchor' };
      }

      // deserializeMd 把 newMarkdown 解析为 Plate 节点数组(无 id,NodeIdPlugin 还未注入)
      const newBlocks = deserializeMd(editor, newMarkdown) as Descendant[];

      // diffToSuggestions:旧块 vs 新块,产带 suggestion mark 的节点数组。
      // ignoreProps:['id'] —— NodeIdPlugin 给每个块加稳定 id,新块没有 id,
      // 不忽略会让 diff 退化成"整块删 + 整块插"(块级 suggestion),
      // SuggestionLeaf 读不到 → 无视觉行内增删痕迹(CLAUDE.md 踩坑记录)。
      const suggested = diffToSuggestions(editor, [oldBlock] as Descendant[], newBlocks, {
        ignoreProps: ['id'],
      }) as Descendant[];

      // 替换该块:先删锚点位置的旧块,再插入带 suggestion mark 的新节点
      editor.tf.removeNodes({ at: [blockIndex] });
      editor.tf.insertNodes(suggested, { at: [blockIndex] });

      if (import.meta.env.DEV) {
        console.debug(
          `[ai-edit] rewrite_selection block=${blockIndex} mdLen=${newMarkdown.length}`,
        );
      }
      return { ok: true, tool };
    }

    // rewrite_document:整篇 diff
    const oldDoc = editor.children as Descendant[];
    const newDoc = deserializeMd(editor, newMarkdown) as Descendant[];

    // 整篇 diffToSuggestions,产带 suggestion mark 的完整文档
    const suggested = diffToSuggestions(editor, oldDoc, newDoc, {
      ignoreProps: ['id'],
    }) as Descendant[];

    // editor.tf.setValue 是 platejs/core 提供的整文档替换 transform,
    // 比手动 removeNodes 循环 + insertNodes 更稳(内部处理 selection normalize 等边缘)。
    // Value = TElement[],diffToSuggestions 实际返回 TElement[] 数组,断言安全。
    editor.tf.setValue(suggested as Value);

    if (import.meta.env.DEV) {
      console.debug(`[ai-edit] rewrite_document mdLen=${newMarkdown.length}`);
    }
    return { ok: true, tool };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[ai-edit] 落地失败', err);
    }
    return { ok: false, tool, reason: 'parse-error' };
  }
}
