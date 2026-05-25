/**
 * SlashKit — "/" 命令菜单插件。
 *
 * 在代码块内不触发（避免和代码输入冲突）。
 */
'use client';

import { SlashInputPlugin, SlashPlugin } from '@platejs/slash-command/react';
import { type SlateEditor, KEYS } from 'platejs';

import { SlashInputElement, GallerySlashInputElement } from '@/components/ui/slash-node';

export const SlashKit = [
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor: SlateEditor) =>
        !editor.api.some({
          match: { type: editor.getType(KEYS.codeBlock) },
        }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
];

/* 画廊随笔：精简命令菜单（只 GalleryEditorKit 支持的块；画廊无代码块，用默认触发） */
export const GallerySlashKit = [
  SlashPlugin,
  SlashInputPlugin.withComponent(GallerySlashInputElement),
];
