/**
 * GalleryEditorKit — 画廊散文编辑器的最小化 Plate 插件套件
 *
 * 包含：
 *   - ParagraphPlugin           基础段落块
 *   - BoldPlugin / ItalicPlugin / UnderlinePlugin / StrikethroughPlugin  行内标记
 *   - LinkKit                   超链接（含 LinkElement + LinkFloatingToolbar）
 *   - ListPlugin                有序列表 + 无序列表（TaskList 不在 Gallery 场景中需要）
 *   - IndentPlugin              缩进（ListPlugin 依赖，注入目标仅 paragraph）
 *   - MarkdownPlugin            Markdown 序列化 / 反序列化
 *   - TrailingBlockPlugin       末尾始终保留空段落
 *
 * 明确排除（Gallery 场景不需要）：
 *   - 标题 (H1–H6)、代码块、表格、图片/媒体
 *   - 日期组件、拖拽排序、字体颜色
 *   - 引用块 (Blockquote)、分割线 (HorizontalRule)
 *   - 浮动工具栏等 React UI 组件（LinkFloatingToolbar 已包含在 LinkKit 中）
 */

import {
  BoldRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
  UnderlineRules,
} from '@platejs/basic-nodes';
import {
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react';
import { IndentPlugin } from '@platejs/indent/react';
import { LinkKit } from './plugins/link-kit';
import {
  BulletedListRules,
  OrderedListRules,
} from '@platejs/list';
import { ListPlugin } from '@platejs/list/react';
import { MarkdownPlugin, remarkMdx } from '@platejs/markdown';
import { KEYS, TrailingBlockPlugin } from 'platejs';
import { ParagraphPlugin } from 'platejs/react';
import remarkGfm from 'remark-gfm';

export const GalleryEditorKit = [
  /* 基础段落块 */
  ParagraphPlugin,

  /* 行内标记：粗体 / 斜体 / 下划线 / 删除线 */
  BoldPlugin.configure({
    inputRules: [
      BoldRules.markdown({ variant: '*' }),
      BoldRules.markdown({ variant: '_' }),
      MarkComboRules.markdown({ variant: 'boldItalic' }),
      MarkComboRules.markdown({ variant: 'boldUnderline' }),
      MarkComboRules.markdown({ variant: 'boldItalicUnderline' }),
      MarkComboRules.markdown({ variant: 'italicUnderline' }),
    ],
  }),
  ItalicPlugin.configure({
    inputRules: [
      ItalicRules.markdown({ variant: '*' }),
      ItalicRules.markdown({ variant: '_' }),
    ],
  }),
  UnderlinePlugin.configure({
    inputRules: [UnderlineRules.markdown()],
  }),
  StrikethroughPlugin.configure({
    inputRules: [StrikethroughRules.markdown()],
  }),

  /* 超链接：复用 LinkKit（含 LinkElement 渲染 + LinkFloatingToolbar 编辑弹窗） */
  ...LinkKit,

  /* 缩进：仅注入段落节点（Gallery 场景无标题/代码块） */
  IndentPlugin.configure({
    inject: {
      targetPlugins: [KEYS.p],
    },
    options: {
      offset: 24,
    },
  }),

  /* 列表：无序 + 有序；IndentPlugin 已在上方单独注册 */
  ListPlugin.configure({
    inputRules: [
      BulletedListRules.markdown({ variant: '-' }),
      BulletedListRules.markdown({ variant: '*' }),
      OrderedListRules.markdown({ variant: '.' }),
      OrderedListRules.markdown({ variant: ')' }),
    ],
    inject: {
      targetPlugins: [KEYS.p],
    },
  }),

  /* Markdown 序列化 / 反序列化，与主编辑器保持相同 remark 插件 */
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [
        remarkGfm,
        remarkMdx,
      ],
    },
  }),

  /* 末尾始终保留一个空段落，确保可在最后一块后继续输入 */
  TrailingBlockPlugin,
];
