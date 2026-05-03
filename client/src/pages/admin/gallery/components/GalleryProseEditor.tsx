/*
 * GalleryProseEditor — 画廊随笔 Plate 富文本编辑器（紧凑版）
 *
 * 与全功能 PlateMarkdownEditor 的区别：
 *   - 使用 GalleryEditorKit 插件套件（无标题、代码块、表格等）
 *   - 内置工具栏（不通过 Portal 渲染到外部）
 *   - 300 字符限制计数器，超限时计数变红
 *   - 最小高度 100px，适合画廊随笔输入场景
 */

import { useCallback, useState } from 'react';
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { NodeApi } from 'platejs';
import { Plate, usePlateEditor } from 'platejs/react';
import { deserializeMd, serializeMd } from '@platejs/markdown';
import { ListStyleType, toggleList, someList } from '@platejs/list';
import { useEditorRef, useEditorSelector } from 'platejs/react';

import { GalleryEditorKit } from '@/components/editor/gallery-editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { LinkToolbarButton } from '@/components/ui/link-toolbar-button';
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button';
import { Toolbar, ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar';
import { TooltipProvider } from '@/components/ui/tooltip';

const CHAR_LIMIT = 300;

/* 从 editor.children 提取所有纯文本，用于字符计数 */
function getEditorPlainText(editor: ReturnType<typeof usePlateEditor>): string {
  if (!editor?.children) return '';
  return editor.children
    .map((node) => NodeApi.string(node))
    .join('');
}

export function GalleryProseEditor({
  initialMarkdown,
  onChange,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
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

  /* 每次内容变更时序列化回 Markdown，并通知父组件 */
  const handleChange = useCallback(() => {
    if (!editor) return;
    try {
      const md = serializeMd(editor);
      onChange(md);
    } catch {
      /* 快速编辑时序列化偶尔失败，跳过本次，下次变更会补上 */
    }
  }, [editor, onChange]);

  if (!editor) return null;

  return (
    <TooltipProvider>
      <Plate key={editorId} editor={editor} onValueChange={handleChange}>
        <GalleryProseEditorInner />
      </Plate>
    </TooltipProvider>
  );
}

/* 内层组件：在 Plate 上下文内读取 editor，以便 charCount 响应编辑变化 */
function GalleryProseEditorInner() {
  /* useEditorSelector 在每次 editor 状态更新后重新计算字符数 */
  const charCount = useEditorSelector(
    (editor) => getEditorPlainText(editor).length,
    [],
  );

  const isOverLimit = charCount > CHAR_LIMIT;

  return (
    <div className="flex flex-col">
      {/* 标签行：左侧"随笔"，右侧字符计数 */}
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
          随笔
        </span>
        <span
          className="text-2xs"
          style={{ color: isOverLimit ? 'var(--mark-red)' : 'var(--ink-ghost)' }}
        >
          {charCount} / {CHAR_LIMIT}
        </span>
      </div>

      {/* 编辑器外框：工具栏（圆角上方）+ 编辑区（圆角下方）共用边框 */}
      <div className="rounded-md border border-border">
        {/* 工具栏：贴顶，圆角上方 */}
        <Toolbar className="flex w-full items-center gap-0 rounded-t-md border-b border-border bg-muted/40 px-2 py-0.5">
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
          </ToolbarGroup>

          <ToolbarGroup>
            <BulletedListButton />
            <NumberedListButton />
          </ToolbarGroup>
        </Toolbar>

        {/* 编辑区：贴底，圆角下方，样式与 note 编辑器对齐 */}
        <EditorContainer className="rounded-b-md">
          <Editor
            variant="none"
            className="min-h-[120px] w-full px-4 pt-3 pb-8 text-base"
            placeholder="写点什么…"
          />
        </EditorContainer>
      </div>
    </div>
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
