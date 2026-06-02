'use client';

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  PaperclipIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorReadOnly } from 'platejs/react';

import { getSelectionTextInContainer } from '@/hooks/use-selected-text';
import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { ToolbarButton, ToolbarGroup, ToolbarSeparator } from './toolbar';

/**
 * FloatingToolbarButtons — 浮动工具栏的按钮集合。
 *
 * 只包含高频内联格式操作（粗体/斜体/下划线/删除线/代码/链接）。
 * 块级操作（标题/列表/表格等）通过 / 斜杠命令完成。
 */
export function FloatingToolbarButtons({
  onAddSelectionToChat,
}: {
  onAddSelectionToChat?: (text: string) => void;
}) {
  const readOnly = useEditorReadOnly();

  if (readOnly) return null;

  return (
    <>
      {onAddSelectionToChat && (
        <>
          <ToolbarGroup>
            <ToolbarButton
              tooltip="添加到聊天"
              className="gap-1.5 px-2"
              onMouseDown={(e) => {
                // 防止 toolbar 抢焦点导致浏览器 selection 在 click 前折叠。
                e.preventDefault();
                const text = getSelectionTextInContainer(
                  '.prose-draft-editor-surface [data-slate-editor]',
                );
                if (text) {
                  onAddSelectionToChat(text);
                  window.getSelection()?.removeAllRanges();
                  // Plate / browser selection reconciliation can restore the range once during
                  // toolbar click handling; clear again after the current event so the toolbar
                  // disappears and the attached chip becomes the source of truth.
                  window.setTimeout(
                    () => window.getSelection()?.removeAllRanges(),
                    0,
                  );
                }
              }}
            >
              <PaperclipIcon />
              <span className="text-xs">添加到聊天</span>
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarSeparator />
        </>
      )}

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
      {/* 用户高亮按钮(WritingHighlightButton)2026-06-02 撤回:
       *   markdown 持久化层不支持 inline 字色/背景色,刷新即丢;且 Plate 浮动 toolbar
       *   selection 时序问题导致部分点击不生效。需要等"高亮持久化"专门阶段重做。
       *   CSS var(--writing-*) 和 design-language.md §3.3 色板定义保留作资产,届时直接复用。 */}
    </>
  );
}
