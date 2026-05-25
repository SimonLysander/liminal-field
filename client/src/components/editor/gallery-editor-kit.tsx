/**
 * GalleryEditorKit — 画廊随笔编辑器插件套件
 *
 * 与 Notes EditorKit 共享基础块（H1-H3、引用、分割线）和行内标记，
 * 确保字号系统和渲染组件完全一致。
 *
 * 排除（Gallery 随笔不需要）：
 *   - H4-H6、代码块、表格、图片/媒体、日期、拖拽、字体颜色、数学公式
 */

import {
  BlockquoteRules,
  BoldRules,
  HeadingRules,
  HorizontalRuleRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
  UnderlineRules,
} from '@platejs/basic-nodes';
import {
  BlockquotePlugin,
  BoldPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  HorizontalRulePlugin,
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

import { BlockquoteElement } from '@/components/ui/blockquote-node';
import { H1Element, H2Element, H3Element } from '@/components/ui/heading-node';
import { HrElement } from '@/components/ui/hr-node';
import { ParagraphElement } from '@/components/ui/paragraph-node';
import { GallerySlashKit } from './plugins/slash-kit';

export const GalleryEditorKit = [
  /* 基础块：段落 + 标题 H1-H3 + 引用 + 分割线（与 Notes 共享渲染组件，字号一致） */
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: { component: H1Element },
    rules: { break: { empty: 'reset' } },
    shortcuts: { toggle: { keys: 'mod+alt+1' } },
  }),
  H2Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: { component: H2Element },
    rules: { break: { empty: 'reset' } },
    shortcuts: { toggle: { keys: 'mod+alt+2' } },
  }),
  H3Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: { component: H3Element },
    rules: { break: { empty: 'reset' } },
    shortcuts: { toggle: { keys: 'mod+alt+3' } },
  }),
  BlockquotePlugin.configure({
    inputRules: [BlockquoteRules.markdown()],
    node: { component: BlockquoteElement },
    shortcuts: { toggle: { keys: 'mod+shift+period' } },
  }),
  HorizontalRulePlugin.configure({
    inputRules: [
      HorizontalRuleRules.markdown({ variant: '-' }),
      HorizontalRuleRules.markdown({ variant: '_' }),
    ],
    node: { component: HrElement },
  }),

  /* 行内标记 */
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

  /* 超链接 */
  ...LinkKit,

  /* 缩进 */
  IndentPlugin.configure({
    inject: { targetPlugins: [KEYS.p] },
    options: { offset: 24 },
  }),

  /* 列表 */
  ListPlugin.configure({
    inputRules: [
      BulletedListRules.markdown({ variant: '-' }),
      BulletedListRules.markdown({ variant: '*' }),
      OrderedListRules.markdown({ variant: '.' }),
      OrderedListRules.markdown({ variant: ')' }),
    ],
    inject: { targetPlugins: [KEYS.p] },
  }),

  /* "/" 命令菜单（精简：只画廊支持的块——正文/标题/列表/引用/分割线） */
  ...GallerySlashKit,

  /* Markdown 序列化 */
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [remarkGfm, remarkMdx],
    },
  }),

  TrailingBlockPlugin,
];
