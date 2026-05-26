/*
 * EditorKit — Plate 编辑器插件套件（精简版）
 *
 * 只保留个人知识库场景必需的插件。
 * 系统以 Markdown + Git 为底层。
 */

'use client';

import { ExitBreakPlugin, TrailingBlockPlugin } from 'platejs';
import { AIPlugin, AIChatPlugin } from '@platejs/ai/react';
import { SuggestionPlugin } from '@platejs/suggestion/react';

import { SuggestionLeaf } from '@/components/ui/suggestion-node';
import { BasicNodesKit } from './plugins/basic-nodes-kit';
import { CodeBlockKit } from './plugins/code-block-kit';
import { DateKit } from './plugins/date-kit';
import { LinkKit } from './plugins/link-kit';
import { ListKit } from './plugins/list-kit';
import { TableKit } from './plugins/table-kit';
import { MediaKit } from './plugins/media-kit';
import { FontKit } from './plugins/font-kit';
import { MathKit } from './plugins/math-kit';
import { MarkdownKit } from './plugins/markdown-kit';
import { SlashKit } from './plugins/slash-kit';

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
  ...SlashKit,

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
     suggestion_<id> 数据没人渲染 → 痕迹视觉隐身(踩坑见 suggestion-node.tsx 注释)。 */
  SuggestionPlugin.configure({
    node: { component: SuggestionLeaf },
    options: { currentUserId: 'aurora' },
  }),

  /* Aurora 改稿 v2:
     - AIPlugin 提供 withAIBatch / insertAINodes / applyAISuggestions 等底层 transform,
       是 v2 改稿落地的核心基础设施。
     - AIChatPlugin 仅装 store(applyAISuggestions 内部读 chatNodes / mode 等状态),
       【不开】它的 combobox UI——我们用自己的聊天面板 useAdvisorChat,不绑 useChat。
       不传 render / chat 字段,只 configure options:{} 注册 store。 */
  AIPlugin,
  AIChatPlugin.configure({ options: {} }),
];
