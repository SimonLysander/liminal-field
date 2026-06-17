/**
 * PasteCleanupKit — 接管 Plate 默认 HTML paste，走 turndown 清洗
 *
 * 设计：
 *   - clipboardData.files.length > 0  →  放行（让 Plate media paste 接管图片）
 *   - clipboardData.types 含 'text/html'  →  HTML → markdown → deserializeMd → 灌入
 *   - 其他（纯文本 / markdown 源码）  →  放行（保留 Plate inputRules）
 *
 * 注意：Plate 53 的 onPaste handler 拿到的是 React.ClipboardEvent，
 * React.ClipboardEvent 上已有 clipboardData 属性，不需要额外类型转换。
 */
'use client';

import { createPlatePlugin } from 'platejs/react';
import { deserializeMd } from '@platejs/markdown';

import { htmlToCleanMarkdown } from '@/lib/paste-cleanup';

export const PasteCleanupPlugin = createPlatePlugin({
  key: 'paste-cleanup',
}).extend({
  handlers: {
    onPaste: ({ editor, event }) => {
      const data = event.clipboardData;
      if (!data) return;

      // 1) 图片/文件 paste —— 放行给 Plate media paste handler
      if (data.files && data.files.length > 0) return;

      const types = Array.from(data.types || []);
      // 2) 无 HTML —— 走 Plate 默认 paste（保留 inputRules / autolink）
      if (!types.includes('text/html')) return;

      const html = data.getData('text/html');
      const markdown = htmlToCleanMarkdown(html);

      // 3) 清洗失败或返回空 —— 让 Plate 默认 paste 接管（不阻断用户操作）
      if (!markdown) return;

      try {
        const nodes = deserializeMd(editor, markdown);
        if (!nodes || nodes.length === 0) return;
        event.preventDefault();
        editor.tf.insertFragment(nodes);
      } catch (err) {
        console.error('[paste-cleanup] deserializeMd 失败，退回默认 paste:', err);
      }
    },
  },
});

export const PasteCleanupKit = [PasteCleanupPlugin];
