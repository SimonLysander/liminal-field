/**
 * applyAiEdit —— v2 改稿落地:按工具名 + 当前锚点路由到 @platejs/ai 的对应 transform。
 *
 * 三场景:
 * - rewrite_selection:把锚点指向的块设进 AIChatPlugin 的 chatNodes store,mode='chat',
 *   再调 applyAISuggestions(editor, newMarkdown)。applyAISuggestions 内部读 chatNodes
 *   做 diffToSuggestions,逐块产 suggestion 痕迹。
 * - insert_at_cursor:withAIBatch 内调 editor.api.ai.insertNodes(nodes, { target: at })
 *   在光标/选区所在块之后顶层插入;无锚点(none)兜底到文末。
 * - rewrite_document:chatNodes = editor.children(整篇),mode='chat',applyAISuggestions
 *   按块逐个 diff。
 *
 * 失败兜底:
 * - rewrite_selection 但无 range 锚点 → no-anchor 不动编辑器;
 * - markdown 解析 / transform 抛错 → parse-error;
 * 失败的 outcome 由上层卡片标红展示(spec §9)。
 *
 * API 来源(以实际 d.ts 为准):
 * - applyAISuggestions  @platejs/ai/react  (SlateEditor, content: string) => void
 * - withAIBatch         @platejs/ai        (SlateEditor, fn: () => void, options?) => void
 * - insertAINodes       @platejs/ai        (SlateEditor, Descendant[], { target?: Path }?) => void
 *   → 实际通过 editor.api.ai.insertNodes 调用(OmitFirst<insertAINodes>)
 * - AIChatPlugin        @platejs/ai/react
 * - deserializeMd       @platejs/markdown
 */

import type { TIdElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { AIChatPlugin, applyAISuggestions } from '@platejs/ai/react';
import { withAIBatch, insertAINodes } from '@platejs/ai';
import { deserializeMd } from '@platejs/markdown';

import type { AnchorPayload } from './serialize-anchor';

export type AiEditTool = 'rewrite_selection' | 'insert_at_cursor' | 'rewrite_document';

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
      const selectedBlock = editor.children[blockIndex];
      if (!selectedBlock) {
        return { ok: false, tool, reason: 'no-anchor' };
      }

      // 把选中块放进 AIChatPlugin store —— applyAISuggestions 内部读 chatNodes
      // 做 diffToSuggestions(旧块 vs newMarkdown 反序列化块),产 suggestion 痕迹
      editor.setOption(AIChatPlugin, 'chatNodes', [selectedBlock] as TIdElement[]);
      editor.setOption(AIChatPlugin, 'mode', 'chat');
      applyAISuggestions(editor, newMarkdown);

      if (import.meta.env.DEV) {
        console.debug(
          `[ai-edit] rewrite_selection block=${blockIndex} mdLen=${newMarkdown.length}`,
        );
      }
      return { ok: true, tool };
    }

    if (tool === 'insert_at_cursor') {
      // 光标 / range 都按"该块之后"插入;无锚点(none)兜底到文末
      const baseIdx =
        anchor.type === 'cursor' || anchor.type === 'range'
          ? (anchor.blockIndex ?? -1)
          : editor.children.length - 1;

      // Plate Path:顶层索引 = [baseIdx + 1]
      const at: [number] = [baseIdx + 1];

      withAIBatch(editor, () => {
        const nodes = deserializeMd(editor, newMarkdown);
        // insertAINodes 直接从 @platejs/ai 主路径导入调用
        insertAINodes(editor, nodes, { target: at });
      });

      if (import.meta.env.DEV) {
        console.debug(
          `[ai-edit] insert_at_cursor at=${JSON.stringify(at)} mdLen=${newMarkdown.length}`,
        );
      }
      return { ok: true, tool };
    }

    // rewrite_document:整篇做 diff → chatNodes = editor.children
    editor.setOption(AIChatPlugin, 'chatNodes', editor.children as TIdElement[]);
    editor.setOption(AIChatPlugin, 'mode', 'chat');
    applyAISuggestions(editor, newMarkdown);

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
