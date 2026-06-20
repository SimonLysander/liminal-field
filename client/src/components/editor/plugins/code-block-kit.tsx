'use client';

import {
  CodeBlockRules,
  indentCodeLine,
  outdentCodeLine,
} from '@platejs/code-block';
import {
  CodeBlockPlugin,
  CodeLinePlugin,
  CodeSyntaxPlugin,
} from '@platejs/code-block/react';
import { common, createLowlight } from 'lowlight';
import type { TElement } from 'platejs';
import { KEYS } from 'platejs';

import {
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
} from '@/components/ui/code-block-node';

/* common 预设包含 bash/css/js/ts/python/cpp/xml 等常用语言 */
const lowlight = createLowlight(common);

export const CodeBlockKit = [
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: 'match' })],
    node: { component: CodeBlockElement },
    options: { lowlight },
    shortcuts: { toggle: { keys: 'mod+alt+8' } },
    handlers: {
      // Tab / Shift+Tab 在代码块内 → 2 空格缩进 / 反缩进，
      // 不让浏览器默认 Tab 切焦点跳出编辑器。
      onKeyDown: ({ editor, event }) => {
        if (event.nativeEvent.isComposing) return;  // IME 输入中不响应
        if (event.key !== 'Tab') return;
        const codeLine = editor.api.node<TElement>({
          match: { type: editor.getType(KEYS.codeLine) },
        });
        if (!codeLine) return;
        const codeBlock = editor.api.node<TElement>({
          match: { type: editor.getType(KEYS.codeBlock) },
        });
        if (!codeBlock) return;
        event.preventDefault();
        const opts = { codeBlock, codeLine };
        if (event.shiftKey) outdentCodeLine(editor, opts);
        else indentCodeLine(editor, { ...opts, indentDepth: 2 });
      },
    },
  }),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
];
