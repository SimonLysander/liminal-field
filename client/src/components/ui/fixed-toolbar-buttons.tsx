'use client';

import type { TElement } from 'platejs';

import { useIndentButton, useOutdentButton } from '@platejs/indent/react';
import {
  BaselineIcon,
  BoldIcon,
  CalendarIcon,
  Code2Icon,
  FileCodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  ItalicIcon,
  PaintBucketIcon,
  PilcrowIcon,
  QuoteIcon,
  RadicalIcon,
  StrikethroughIcon,
  TableIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorRef, useEditorReadOnly, useSelectionFragmentProp } from 'platejs/react';

import {
  getBlockType,
  insertBlock,
  insertInlineElement,
  setBlockType,
} from '@/components/editor/transforms';

import { FontColorToolbarButton } from './font-color-toolbar-button';
import { RedoToolbarButton, UndoToolbarButton } from './history-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from './list-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { MediaToolbarButton } from './media-toolbar-button';
import { ToolbarButton, ToolbarGroup } from './toolbar';

export function FixedToolbarButtons() {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();

  // 检测当前选区的块类型，用于高亮对应按钮
  const blockType = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });

  return (
    <div className="flex w-max max-w-full flex-wrap items-center justify-center gap-x-1">
      {!readOnly && (
        <>
          <ToolbarGroup>
            <UndoToolbarButton />
            <RedoToolbarButton />
          </ToolbarGroup>

          <ToolbarGroup>
            <ToolbarButton
              pressed={blockType === KEYS.p}
              onClick={() => setBlockType(editor, KEYS.p)}
              tooltip="正文"
            >
              <PilcrowIcon />
            </ToolbarButton>

            <ToolbarButton
              pressed={blockType === 'h1'}
              onClick={() => setBlockType(editor, 'h1')}
              tooltip="标题 1"
            >
              <Heading1Icon />
            </ToolbarButton>

            <ToolbarButton
              pressed={blockType === 'h2'}
              onClick={() => setBlockType(editor, 'h2')}
              tooltip="标题 2"
            >
              <Heading2Icon />
            </ToolbarButton>

            <ToolbarButton
              pressed={blockType === 'h3'}
              onClick={() => setBlockType(editor, 'h3')}
              tooltip="标题 3"
            >
              <Heading3Icon />
            </ToolbarButton>

            <ToolbarButton
              pressed={blockType === KEYS.blockquote}
              onClick={() => setBlockType(editor, KEYS.blockquote)}
              tooltip="引用"
            >
              <QuoteIcon />
            </ToolbarButton>

            <ToolbarButton
              pressed={blockType === KEYS.codeBlock}
              onClick={() => setBlockType(editor, KEYS.codeBlock)}
              tooltip="代码块"
            >
              <FileCodeIcon />
            </ToolbarButton>
          </ToolbarGroup>

          <ToolbarGroup>
            <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (⌘+B)">
              <BoldIcon />
            </MarkToolbarButton>

            <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (⌘+I)">
              <ItalicIcon />
            </MarkToolbarButton>

            <MarkToolbarButton
              nodeType={KEYS.underline}
              tooltip="Underline (⌘+U)"
            >
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

            <FontColorToolbarButton nodeType={KEYS.color} tooltip="Text color">
              <BaselineIcon />
            </FontColorToolbarButton>

            <FontColorToolbarButton
              nodeType={KEYS.backgroundColor}
              tooltip="Background color"
            >
              <PaintBucketIcon />
            </FontColorToolbarButton>
          </ToolbarGroup>

          <ToolbarGroup>
            <NumberedListToolbarButton />
            <BulletedListToolbarButton />
            <TodoListToolbarButton />
          </ToolbarGroup>

          <ToolbarGroup>
            <IndentToolbarButton />
            <OutdentToolbarButton />
          </ToolbarGroup>

          <ToolbarGroup>
            <ToolbarButton
              onClick={() => insertBlock(editor, KEYS.table)}
              tooltip="插入表格"
            >
              <TableIcon />
            </ToolbarButton>
            <LinkToolbarButton />
            <ToolbarButton
              onClick={() => insertInlineElement(editor, KEYS.date)}
              tooltip="插入日期"
            >
              <CalendarIcon />
            </ToolbarButton>
            <MediaToolbarButton nodeType={KEYS.img} />
            <ToolbarButton
              onClick={() => insertBlock(editor, 'equation')}
              tooltip="插入公式块"
            >
              <RadicalIcon />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => insertInlineElement(editor, 'inline_equation')}
              tooltip="插入行内公式"
            >
              <span className="font-serif text-xs italic">fx</span>
            </ToolbarButton>
          </ToolbarGroup>
        </>
      )}
    </div>
  );
}

function IndentToolbarButton() {
  const { props } = useIndentButton();
  return (
    <ToolbarButton tooltip="增加缩进" {...props}>
      <IndentIncreaseIcon />
    </ToolbarButton>
  );
}

function OutdentToolbarButton() {
  const { props } = useOutdentButton();
  return (
    <ToolbarButton tooltip="减少缩进" {...props}>
      <IndentDecreaseIcon />
    </ToolbarButton>
  );
}
