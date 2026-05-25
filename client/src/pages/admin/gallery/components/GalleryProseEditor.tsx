/*
 * GalleryProseEditor — 画廊随笔 Plate 富文本编辑器（紧凑版）
 *
 * 与全功能 PlateMarkdownEditor 的区别：
 *   - 使用 GalleryEditorKit 插件套件（无标题、代码块、表格等）
 *   - 内置工具栏（不通过 Portal 渲染到外部）
 *   - 500 字符限制计数器，超限时计数变红
 *   - 最小高度 100px，适合画廊随笔输入场景
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BoldIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS, NodeApi, type TElement } from 'platejs';
import { Plate, usePlateEditor } from 'platejs/react';
import { deserializeMd, serializeMd } from '@platejs/markdown';
import { ListStyleType, toggleList, someList } from '@platejs/list';
import { useEditorRef, useEditorSelector, useSelectionFragmentProp } from 'platejs/react';
import { getBlockType, insertBlock, setBlockType } from '@/components/editor/transforms';

import { GalleryEditorKit } from '@/components/editor/gallery-editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { LinkToolbarButton } from '@/components/ui/link-toolbar-button';
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button';
import { ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { TooltipProvider } from '@/components/ui/tooltip';

const CHAR_LIMIT = 500;

/* 从 editor.children 提取所有纯文本，用于字符计数 */
function getEditorPlainText(editor: ReturnType<typeof usePlateEditor>): string {
  if (!editor?.children) return '';
  return editor.children
    .map((node) => NodeApi.string(node))
    .join('');
}

export const PROSE_CHAR_LIMIT = CHAR_LIMIT;

export function GalleryProseEditor({
  initialMarkdown,
  onChange,
  onCharCountChange,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** 字符数变化回调，供外部渲染固定位置的计数器 */
  onCharCountChange?: (count: number) => void;
}) {
  const [editorId] = useState(() => `plate-gallery-${Math.random().toString(36).slice(2)}`);

  const editor = usePlateEditor(
    {
      id: editorId,
      plugins: GalleryEditorKit,
      value: (editor) => {
        try {
          return deserializeMd(editor, initialMarkdown || '');
        } catch {
          return [{ type: 'p', children: [{ text: '' }] }];
        }
      },
    },
    [],
  );

  /* 每次内容变更时序列化回 Markdown，超限时撤销 */
  const handleChange = useCallback(() => {
    if (!editor) return;
    // 超限阻止：撤销本次输入
    const plainText = getEditorPlainText(editor);
    if (plainText.length > CHAR_LIMIT) {
      editor.undo();
      return;
    }
    try {
      const md = serializeMd(editor);
      onChange(md);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[GalleryProseEditor] 序列化失败 (通常为暂态):', err);
      // 序列化失败通常为暂态，忽略
    }
  }, [editor, onChange]);

  if (!editor) return null;

  return (
    <TooltipProvider>
      <Plate key={editorId} editor={editor} onValueChange={handleChange}>
        <GalleryProseEditorInner onCharCountChange={onCharCountChange} />
      </Plate>
    </TooltipProvider>
  );
}

/* 内层组件：工具栏 Portal 到 topbar，编辑区留在原位 */
function GalleryProseEditorInner({ onCharCountChange }: { onCharCountChange?: (count: number) => void }) {
  const charCount = useEditorSelector(
    (editor) => getEditorPlainText(editor).length,
    [],
  );

  // 通知外部字符数变化
  useEffect(() => { onCharCountChange?.(charCount); }, [charCount, onCharCountChange]);

  return (
    <div className="relative">
      <EditorContainer>
        <Editor
          variant="none"
          className="w-full px-4 py-2 pb-6 text-base"
          style={{ minHeight: 36 }}
          placeholder="写点什么…"
        />
      </EditorContainer>
      {/* 浮动工具栏:选中文字时浮现,与笔记/文集编辑器机制统一(撤销/重做走 ⌘Z/⌘⇧Z 快捷键) */}
      <FloatingToolbar>
        <ToolbarGroup>
          <HeadingButton level="h1" icon={<Heading1Icon />} tooltip="标题 1 (⌘⌥1)" />
          <HeadingButton level="h2" icon={<Heading2Icon />} tooltip="标题 2 (⌘⌥2)" />
          <HeadingButton level="h3" icon={<Heading3Icon />} tooltip="标题 3 (⌘⌥3)" />
          <HeadingButton level={KEYS.p} icon={<PilcrowIcon />} tooltip="正文" />
        </ToolbarGroup>
        <ToolbarGroup>
          <MarkToolbarButton nodeType="bold" tooltip="粗体 (⌘B)">
            <BoldIcon />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="italic" tooltip="斜体 (⌘I)">
            <ItalicIcon />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="underline" tooltip="下划线 (⌘U)">
            <UnderlineIcon />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="strikethrough" tooltip="删除线">
            <StrikethroughIcon />
          </MarkToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup>
          <LinkToolbarButton tooltip="链接" />
          <BlockquoteButton />
          <HorizontalRuleButton />
        </ToolbarGroup>
        <ToolbarGroup>
          <BulletedListButton />
          <NumberedListButton />
        </ToolbarGroup>
      </FloatingToolbar>
      <span
        className="absolute bottom-1 right-1 text-2xs pointer-events-none"
        style={{ color: charCount > CHAR_LIMIT ? 'var(--mark-red)' : 'var(--ink-ghost)' }}
      >
        {charCount} / {CHAR_LIMIT}
      </span>
    </div>
  );
}

/* 引用块按钮 */
function BlockquoteButton() {
  const editor = useEditorRef();
  const blockType = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });
  return (
    <ToolbarButton
      tooltip="引用"
      pressed={blockType === KEYS.blockquote}
      onMouseDown={(e) => {
        e.preventDefault();
        setBlockType(editor, KEYS.blockquote);
      }}
    >
      <QuoteIcon />
    </ToolbarButton>
  );
}

/* 无序列表按钮：用 ToolbarButton（不是 MarkToolbarButton）避免 mark toggle 干扰 */
function BulletedListButton() {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (editor) => someList(editor, [ListStyleType.Disc]),
    [],
  );

  return (
    <ToolbarButton
      tooltip="无序列表"
      pressed={pressed}
      onMouseDown={(e) => {
        e.preventDefault();
        toggleList(editor, { listStyleType: ListStyleType.Disc });
      }}
    >
      <ListIcon />
    </ToolbarButton>
  );
}

/* 有序列表按钮 */
function NumberedListButton() {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (editor) => someList(editor, [ListStyleType.Decimal]),
    [],
  );

  return (
    <ToolbarButton
      tooltip="有序列表"
      pressed={pressed}
      onMouseDown={(e) => {
        e.preventDefault();
        toggleList(editor, { listStyleType: ListStyleType.Decimal });
      }}
    >
      <ListOrderedIcon />
    </ToolbarButton>
  );
}

/* 标题切换按钮（H1/H2/H3/正文） */
function HeadingButton({ level, icon, tooltip }: { level: string; icon: React.ReactNode; tooltip: string }) {
  const editor = useEditorRef();
  const blockType = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  });
  return (
    <ToolbarButton
      tooltip={tooltip}
      pressed={blockType === level}
      onMouseDown={(e) => {
        e.preventDefault();
        setBlockType(editor, level);
      }}
    >
      {icon}
    </ToolbarButton>
  );
}

/* 分割线插入按钮 */
function HorizontalRuleButton() {
  const editor = useEditorRef();
  return (
    <ToolbarButton
      tooltip="分割线"
      onMouseDown={(e) => {
        e.preventDefault();
        insertBlock(editor, KEYS.hr);
      }}
    >
      <MinusIcon />
    </ToolbarButton>
  );
}
