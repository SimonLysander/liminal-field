/**
 * SlashInputElement — 输入 "/" 触发的命令菜单。
 *
 * 只包含项目实际启用的插件对应的命令项。
 * 复用 transforms.ts 中已有的 insertBlock / insertInlineElement。
 */
'use client';

import * as React from 'react';

import type { PlateEditor, PlateElementProps } from 'platejs/react';

import {
  CalendarIcon,
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  RadicalIcon,
  SquareCheckIcon,
  TableIcon,
  Wand2Icon,
} from 'lucide-react';
import { type TComboboxInputElement, KEYS } from 'platejs';
import { PlateElement } from 'platejs/react';

import {
  insertBlock,
  insertInlineElement,
} from '@/components/editor/transforms';
import { requestInlineAssist } from '@/components/editor/inline-assist-events';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

type SlashGroup = {
  group: string;
  items: {
    icon: React.ReactNode;
    value: string;
    onSelect: (editor: PlateEditor, value: string) => void;
    closeOnSelect?: boolean;
    focusEditor?: boolean;
    keywords?: string[];
    label?: string;
  }[];
};

const groups: SlashGroup[] = [
  {
    group: 'AI',
    items: [
      {
        icon: <Wand2Icon />,
        keywords: ['ai', 'write', 'continue', '续写', '帮我写'],
        label: '帮我写',
        value: 'inline-assist',
        focusEditor: false,
        onSelect: (editor: PlateEditor) => {
          requestInlineAssist({
            action: 'open-menu',
            editorId: String(editor.id),
          });
        },
      },
    ],
  },
  {
    group: '基础块',
    items: [
      {
        icon: <PilcrowIcon />,
        keywords: ['paragraph', 'text', '正文'],
        label: '正文',
        value: KEYS.p,
      },
      {
        icon: <Heading1Icon />,
        keywords: ['title', 'h1', '标题'],
        label: '一级标题',
        value: 'h1',
      },
      {
        icon: <Heading2Icon />,
        keywords: ['subtitle', 'h2', '标题'],
        label: '二级标题',
        value: 'h2',
      },
      {
        icon: <Heading3Icon />,
        keywords: ['subtitle', 'h3', '标题'],
        label: '三级标题',
        value: 'h3',
      },
      {
        icon: <ListIcon />,
        keywords: ['unordered', 'ul', '-', '无序', '列表'],
        label: '无序列表',
        value: KEYS.ul,
      },
      {
        icon: <ListOrderedIcon />,
        keywords: ['ordered', 'ol', '1', '有序', '编号'],
        label: '有序列表',
        value: KEYS.ol,
      },
      {
        icon: <SquareCheckIcon />,
        keywords: ['checklist', 'task', 'checkbox', '[]', '待办', '任务'],
        label: '待办列表',
        value: KEYS.listTodo,
      },
      {
        icon: <Code2Icon />,
        keywords: ['```', '代码'],
        label: '代码块',
        value: KEYS.codeBlock,
      },
      {
        icon: <TableIcon />,
        keywords: ['表格'],
        label: '表格',
        value: KEYS.table,
      },
      {
        icon: <QuoteIcon />,
        keywords: ['citation', 'blockquote', '>', '引用'],
        label: '引用',
        value: KEYS.blockquote,
      },
      {
        icon: <MinusIcon />,
        keywords: ['hr', 'divider', '---', '分割线', '分隔'],
        label: '分割线',
        value: KEYS.hr,
      },
    ].map((item) => ({
      ...item,
      onSelect: (editor: PlateEditor, value: string) => {
        insertBlock(editor, value, { upsert: true });
      },
    })),
  },
  {
    group: '行内元素',
    items: [
      {
        icon: <CalendarIcon />,
        keywords: ['time', '日期', '时间'],
        label: '日期',
        value: KEYS.date,
      },
      {
        icon: <RadicalIcon />,
        keywords: ['math', 'latex', '公式', '数学'],
        label: '公式块',
        value: 'equation',
        onSelect: (editor: PlateEditor) => {
          insertBlock(editor, 'equation');
        },
      },
      {
        icon: <span className="font-serif text-xs italic">fx</span>,
        keywords: ['math', 'latex', 'inline', '行内公式'],
        label: '行内公式',
        value: 'inline_equation',
      },
    ].map((item) => ({
      ...item,
      onSelect: item.onSelect ?? ((editor: PlateEditor, value: string) => {
        insertInlineElement(editor, value);
      }),
    })),
  },
  {
    group: '媒体',
    items: [
      {
        icon: <ImageIcon />,
        keywords: ['photo', 'picture', '图片', '照片'],
        label: '图片',
        value: KEYS.img,
        onSelect: (editor: PlateEditor) => {
          insertBlock(editor, KEYS.img);
        },
      },
    ],
  },
];

/*
 * 画廊随笔精简命令：只含 GalleryEditorKit 支持的基础块（无待办/代码块/表格/媒体/公式）。
 * 从全功能 groups 的「基础块」分组按 value 过滤派生,避免重复维护两份图标/关键词/onSelect
 * (派生保留原顺序,gallery 支持的块与全功能里的相对顺序一致)。
 */
const GALLERY_BLOCK_VALUES = new Set<string>([
  KEYS.p,
  'h1',
  'h2',
  'h3',
  KEYS.ul,
  KEYS.ol,
  KEYS.blockquote,
  KEYS.hr,
]);

const galleryGroups: SlashGroup[] = groups
  .filter((g) => g.group === '基础块')
  .map((g) => ({
    ...g,
    items: g.items.filter((item) => GALLERY_BLOCK_VALUES.has(item.value)),
  }));

/* 命令菜单渲染：全功能与画廊精简共用，仅传入的 groups 不同 */
function SlashMenu({
  editor,
  element,
  groups: menuGroups,
}: {
  editor: PlateEditor;
  element: TComboboxInputElement;
  groups: SlashGroup[];
}) {
  return (
    <InlineCombobox
      element={element}
      trigger="/"
      onNavigateNext={(item) => {
        if (item.value !== 'inline-assist') return false;
        requestInlineAssist({
          action: 'open-menu',
          editorId: String(editor.id),
        });
        return true;
      }}
    >
      <InlineComboboxInput />

      <InlineComboboxContent>
        <InlineComboboxEmpty>无匹配项</InlineComboboxEmpty>

        {menuGroups.map(({ group, items }) => (
          <InlineComboboxGroup key={group}>
            <InlineComboboxGroupLabel>{group}</InlineComboboxGroupLabel>

            {items.map(({ closeOnSelect, focusEditor, icon, keywords, label, value, onSelect }) => (
              <InlineComboboxItem
                key={value}
                value={value}
                onClick={() => onSelect(editor, value)}
                label={label}
                closeOnSelect={closeOnSelect}
                focusEditor={focusEditor}
                group={group}
                keywords={keywords}
              >
                <div className="mr-2 text-muted-foreground">{icon}</div>
                {label ?? value}
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        ))}
      </InlineComboboxContent>
    </InlineCombobox>
  );
}

/* 全功能命令菜单（笔记/文集编辑器用） */
export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { editor, element } = props;
  return (
    <PlateElement {...props} as="span">
      <SlashMenu editor={editor} element={element} groups={groups} />
      {props.children}
    </PlateElement>
  );
}

/* 画廊随笔用：精简命令菜单（只 GalleryEditorKit 支持的块） */
export function GallerySlashInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { editor, element } = props;
  return (
    <PlateElement {...props} as="span">
      <SlashMenu editor={editor} element={element} groups={galleryGroups} />
      {props.children}
    </PlateElement>
  );
}
