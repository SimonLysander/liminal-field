'use client';

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorReadOnly } from 'platejs/react';

import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { ToolbarGroup } from './toolbar';

/**
 * FloatingToolbarButtons — 浮动工具栏的按钮集合。
 *
 * 只包含高频内联格式操作（粗体/斜体/下划线/删除线/代码/链接）。
 * 块级操作（标题/列表/表格等）通过 / 斜杠命令完成。
 */
export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  if (readOnly) return null;

  return (
    <ToolbarGroup>
      <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (⌘+B)">
        <BoldIcon />
      </MarkToolbarButton>

      <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (⌘+I)">
        <ItalicIcon />
      </MarkToolbarButton>

      <MarkToolbarButton nodeType={KEYS.underline} tooltip="Underline (⌘+U)">
        <UnderlineIcon />
      </MarkToolbarButton>

      <MarkToolbarButton
        nodeType={KEYS.strikethrough}
        tooltip="Strikethrough (⌘+⇧+M)"
      >
        <StrikethroughIcon />
      </MarkToolbarButton>

      <MarkToolbarButton nodeType={KEYS.code} tooltip="Code (⌘+E)">
        <Code2Icon />
      </MarkToolbarButton>

      <LinkToolbarButton />
    </ToolbarGroup>
  );
}
