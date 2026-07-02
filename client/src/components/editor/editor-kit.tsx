/*
 * EditorKit — Plate 编辑器插件套件（精简版）
 *
 * 只保留个人知识库场景必需的插件。
 * 系统以 Markdown + Git 为底层。
 */

'use client';

import { SuggestionPlugin } from '@platejs/suggestion/react';
import { AIChatPlugin, AIPlugin } from '@platejs/ai/react';
import { ExitBreakPlugin, TrailingBlockPlugin } from 'platejs';

import { SuggestionLeaf } from '@/components/ui/suggestion-node';

import { BasicNodesKit } from './plugins/basic-nodes-kit';
import { CodeBlockKit } from './plugins/code-block-kit';
import { DateKit } from './plugins/date-kit';
import { FontKit } from './plugins/font-kit';
import { LinkKit } from './plugins/link-kit';
import { ListKit } from './plugins/list-kit';
import { MarkdownKit } from './plugins/markdown-kit';
import { MathKit } from './plugins/math-kit';
import { BlockMenuKit } from './plugins/block-menu-kit';
import { PasteCleanupKit } from './plugins/paste-cleanup-kit';
import { MediaKit } from './plugins/media-kit';
import { SlashKit } from './plugins/slash-kit';
import { TableKit } from './plugins/table-kit';
import { ProposalNewPlugin, ProposalOldPlugin } from './proposal-plugin';
import { AIAnchorElement, AILeaf } from '@/components/ui/ai-node';

export const EditorKit = [
  ...BasicNodesKit,
  ...CodeBlockKit,
  ...DateKit,
  /* DndKit 移除：react-dnd HTML5Backend 会劫持浏览器原生 paste 事件，
     导致 Plate inputRules（列表快捷输入）和 autolink（粘贴链接自动识别）失效。
     块级拖拽排序是低频操作，inputRules 和 autolink 是高频操作，取舍明确。 */
  ...LinkKit,
  ...ListKit,
  ...TableKit,
  ...MediaKit,
  ...FontKit,
  ...MathKit,
  ...MarkdownKit,
  ...PasteCleanupKit,
  ...BlockMenuKit,
  ...SlashKit,

  /* Plate 官方 AI preview/streaming 基础能力。/帮我写 使用它把流式 Markdown
     直接插入为可接受/取消的编辑器内预览,避免维护额外的外部预览状态。 */
  AIPlugin.withComponent(AILeaf),
  AIChatPlugin.withComponent(AIAnchorElement),

  /* ⌘+Enter 跳出代码块/引用等嵌套结构，在后面插入新段落 */
  ExitBreakPlugin.configure({
    shortcuts: {
      insert: { keys: 'mod+enter' },
      insertBefore: { keys: 'mod+shift+enter' },
    },
  }),

  /* 文档末尾始终保留一个空段落，确保能在最后一个块后继续输入 */
  TrailingBlockPlugin,

  /* Aurora 改稿:把"旧→新"渲染成行内增删痕迹,currentUserId 标记改动来源。
     node.component = SuggestionLeaf 必须配,否则 diffToSuggestions 写到 leaf 上的
     suggestion_<id> 数据没人渲染 → 痕迹视觉隐身(CLAUDE.md 已记此坑)。 */
  SuggestionPlugin.configure({
    node: { component: SuggestionLeaf },
    options: { currentUserId: 'aurora' },
  }),

  /* v3.1 改稿审批节点(临时,裁决期间存在):
     proposal-old = 红底删除线旧段落;proposal-new = 绿底 AI 新段落。
     裁决后由 controller 改回 'p' 或 removeNodes。 */
  ProposalOldPlugin,
  ProposalNewPlugin,
];
