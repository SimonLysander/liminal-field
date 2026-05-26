/**
 * applyAiEdit —— v2 改稿落地:按工具名 + 当前锚点路由到 @platejs/ai 的对应 transform。
 *
 * 两场景:
 * - rewrite_selection:把锚点指向的块设进 AIChatPlugin 的 chatNodes store,mode='chat',
 *   再调 applyAISuggestions(editor, newMarkdown)。applyAISuggestions 内部读 chatNodes
 *   做 diffToSuggestions,逐块产 suggestion 痕迹。
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
 * - AIChatPlugin        @platejs/ai/react
 */

import type { TIdElement } from 'platejs';
import type { PlateEditor } from 'platejs/react';
import { getEditorPlugin } from 'platejs/react';
import { applyAISuggestions } from '@platejs/ai/react';

import type { AnchorPayload } from './serialize-anchor';

/**
 * 用 plugin key 字符串拿 setOption,而非 editor.setOption(AIChatPlugin, ...) 三参形式。
 * 为什么:Vite 优化 deps 可能把 @platejs/ai/react 加载成两份,editor-kit 注册的
 * AIChatPlugin 和这里 import 的 AIChatPlugin 不是同一对象引用 → editor 内部 store
 * 按对象引用找不到对应 zustand store → setOption 抛 undefined.set。
 * 用 { key: 'aiChat' } 字符串查找绕过这个对象引用问题,与 @platejs/ai 内部 submitAIChat /
 * resetAIChat 等使用 getEditorPlugin 的模式一致。
 */
function setAiChatOptions(editor: PlateEditor, chatNodes: TIdElement[]) {
  const { setOption } = getEditorPlugin(editor, { key: 'aiChat' });
  setOption('chatNodes', chatNodes);
  setOption('mode', 'chat');
}

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
      const selectedBlock = editor.children[blockIndex];
      if (!selectedBlock) {
        return { ok: false, tool, reason: 'no-anchor' };
      }

      // 把选中块放进 AIChatPlugin store —— applyAISuggestions 内部读 chatNodes
      // 做 diffToSuggestions(旧块 vs newMarkdown 反序列化块),产 suggestion 痕迹
      setAiChatOptions(editor, [selectedBlock] as TIdElement[]);
      applyAISuggestions(editor, newMarkdown);

      if (import.meta.env.DEV) {
        console.debug(
          `[ai-edit] rewrite_selection block=${blockIndex} mdLen=${newMarkdown.length}`,
        );
      }
      return { ok: true, tool };
    }

    // rewrite_document:整篇做 diff → chatNodes = editor.children
    setAiChatOptions(editor, editor.children as TIdElement[]);
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
