import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type KeyboardEvent,
} from 'react';
import { NodeApi, type Descendant, type TElement } from 'platejs';
import {
  createPlatePlugin,
  Plate,
  PlateElement,
  usePlateEditor,
  type PlateElementProps,
} from 'platejs/react';
import type {
  ChatSelectionAttachment,
  AnchorPayload,
} from '@/pages/admin/lib/live-chat-selection';
import { Editor } from '@/components/ui/editor';
import { replaceSlashTokenInText } from './slash-text-utils';

const REFERENCE_TYPE = 'chat_reference';

/**
 * formatReferencesAsMd —— 把 chips 引用拼成 markdown `>` 引用块。
 *
 * v3 协议：chips 是用户显式圈出的注意力锚点（"让模型看这几段"），
 * 拼成 user message text 的一部分，后端不再有独立 references 协议。
 * 位置：紧跟在正文末尾，以两个换行分隔；每条占一行 `> 第N段:「...」`。
 */
function formatReferencesAsMd(references: ChatSelectionAttachment[]): string {
  if (references.length === 0) return '';
  return (
    '\n\n' +
    references
      .map((ref) => {
        // 读取发送瞬间的 live 文本；优先用 getText() 拿最新内容，回退到 preview
        const liveText = ref.getText();
        const displayText = liveText || ref.preview;
        // 位置标签：通过 anchor 里的 blockIndex 计算段号
        const anchor = ref.getAnchor();
        const blockIndex =
          anchor.type === 'range'
            ? anchor.startPath?.[0] ?? anchor.blockIndex
            : undefined;
        const segmentLabel =
          typeof blockIndex === 'number' ? `第 ${blockIndex + 1} 段` : '引用';
        return `> ${segmentLabel}：「${displayText}」`;
      })
      .join('\n')
  );
}

type ReferenceElement = TElement & {
  refId: string;
  label: string;
};
type ComposerEditor = NonNullable<ReturnType<typeof usePlateEditor>>;

/**
 * v3 协议：readAndClear 只返回 { text }。
 * chips 引用已被 formatReferencesAsMd 拼成 markdown `>` 引用块加到 text 末尾，
 * 后端不再有独立 references 协议；chips 是用户显式圈出的注意力锚点，
 * 拼进 user message text，不限制模型改动范围。
 */
export interface ComposerPayload {
  text: string;
}

export interface AiReferenceComposerHandle {
  readAndClear: () => ComposerPayload;
  isEmpty: () => boolean;
  focusEnd: () => void;
  /**
   * Skill slash autocomplete 用:把 composer 当前文本里"以 / 开头的那段(到首个空白前)"
   * 替换为 `/skillName `(尾随空格),保留之后用户已经输入的内容。
   *
   * 设计:
   *   原文 `/cri 这段写得怎么样?` + replaceSlashCommand('critic')
   *   → `/critic 这段写得怎么样?`
   * 没找到 slash 段(理论上浮层不该弹) → 保险起见在最前插入 `/skillName `。
   *
   * 引用 token(chip)是 void inline 节点,不会进 plain text,自然不受影响。
   */
  replaceSlashCommand: (skillName: string) => void;
}

interface AiReferenceComposerProps {
  disabled?: boolean;
  selections: ChatSelectionAttachment[];
  onEmptyChange?: (empty: boolean) => void;
  onRemoveSelection?: (id: string) => void;
  onSubmit?: () => void;
  /**
   * 纯文本变化回调(Skill slash autocomplete 用):上层据此判 / 开头并显隐浮层。
   * 只传文本(不含 chip 引用),回调里别做重计算 —— 上层用 useCallback 稳引用即可。
   */
  onTextChange?: (text: string) => void;
}

const ReferenceTokenPlugin = createPlatePlugin({
  key: REFERENCE_TYPE,
  node: {
    isElement: true,
    isInline: true,
    isVoid: true,
    component: ReferenceTokenElement,
  },
});

export const AiReferenceComposer = forwardRef<
  AiReferenceComposerHandle,
  AiReferenceComposerProps
>(function AiReferenceComposer(
  { disabled, selections, onEmptyChange, onRemoveSelection, onSubmit, onTextChange },
  ref,
) {
  const insertedIdsRef = useRef<Set<string>>(new Set());
  const attachmentByIdRef = useRef<Map<string, ChatSelectionAttachment>>(new Map());
  const selectionsRef = useRef(selections);

  const editor = usePlateEditor(
    {
      plugins: [ReferenceTokenPlugin],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate Value 类型与 Descendant[] 不兼容，需要强制转换
      value: () => cloneEmptyValue() as any,
    },
    [],
  )!;

  useEffect(() => {
    selectionsRef.current = selections;
  }, [selections]);

  useImperativeHandle(
    ref,
    () => ({
      readAndClear: (): ComposerPayload => {
        // v3 协议：chips 引用拼成 markdown > 引用块，作为 text 的一部分发送。
        // 读取发送瞬间所有 live 引用（selectionsRef），再从编辑器 AST 提取纯文本。
        const trimmedText = readComposerText(editor.children);
        const refsMd = formatReferencesAsMd(selectionsRef.current);
        const combined = trimmedText + refsMd;
        // 清 editor（含引用 token）+ 关联映射
        editor.tf.reset();
        insertedIdsRef.current.clear();
        attachmentByIdRef.current.clear();
        queueMicrotask(() => focusComposerEnd(editor));
        onEmptyChange?.(true);
        return { text: combined };
      },
      isEmpty: () => isComposerEmpty(editor.children),
      focusEnd: () => focusComposerEnd(editor),
      replaceSlashCommand: (skillName: string) => {
        // Skill slash 选中:把首段 slash token 替换成 `/skillName `,光标移末尾。
        // 简化处理 —— 拿当前纯文本算出新文本,reset 编辑器再插。
        // (Plate 文档编辑器不能这样粗放,但 advisor composer 只有单段 p + chips,reset 安全)
        const currentText = readComposerText(editor.children);
        const replacement = replaceSlashTokenInText(currentText, skillName);
        editor.tf.reset();
        // 重新插入新文本(reset 后是空段落,直接 insertText 即可)
        focusComposerEnd(editor);
        editor.tf.insertText(replacement);
        // chips 不需要重插:reset 已清,父组件本就维护 selections 状态,
        // 下一次 selections useEffect 会重新插入 chip token(若有引用)。
        onEmptyChange?.(replacement.trim().length === 0);
      },
    }),
    [editor, onEmptyChange],
  );

  useEffect(() => {
    const existingIds = getReferenceIds(editor.children);

    for (const id of Array.from(insertedIdsRef.current)) {
      if (!selections.some((selection) => selection.id === id)) {
        removeReferenceNode(editor, id);
        insertedIdsRef.current.delete(id);
        attachmentByIdRef.current.delete(id);
      }
    }

    selections.forEach((selection) => {
      attachmentByIdRef.current.set(selection.id, selection);
      if (existingIds.has(selection.id)) {
        updateReferenceLabel(
          editor,
          selection.id,
          formatSelectionLabel(selection),
        );
        return;
      }
      insertReferenceNode(editor, selection);
      insertedIdsRef.current.add(selection.id);
    });

    onEmptyChange?.(isComposerEmpty(editor.children));
  }, [editor, onEmptyChange, selections]);

  const handleValueChange = useCallback(() => {
    const ids = getReferenceIds(editor.children);
    for (const id of Array.from(insertedIdsRef.current)) {
      if (!ids.has(id)) {
        insertedIdsRef.current.delete(id);
        attachmentByIdRef.current.delete(id);
        onRemoveSelection?.(id);
      }
    }
    onEmptyChange?.(isComposerEmpty(editor.children));
    // Skill slash autocomplete:推纯文本给上层,据此判 `/xxx` 弹浮层。
    // 读 plain text 跳过引用 token,跟 readAndClear 同源,语义一致。
    onTextChange?.(readComposerText(editor.children));
  }, [editor, onEmptyChange, onRemoveSelection, onTextChange]);

  const editableProps = useMemo(
    () => ({
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSubmit?.();
        }
      },
    }),
    [onSubmit],
  );

  return (
    <Plate editor={editor} onValueChange={handleValueChange} readOnly={disabled}>
      <Editor
        variant="none"
        placeholder="聊点什么..."
        onKeyDown={editableProps.onKeyDown}
        className="composer-input min-h-7 max-h-28 flex-1 overflow-y-auto bg-transparent py-1 text-sm leading-normal outline-none"
        style={{ color: 'var(--ink)', opacity: disabled ? 0.5 : 1 }}
      />
    </Plate>
  );
});

function ReferenceTokenElement(props: PlateElementProps<ReferenceElement>) {
  const { element } = props;
  return (
    <PlateElement
      {...props}
      as="span"
      attributes={{
        ...props.attributes,
        contentEditable: false,
        'data-ref-id': element.refId,
      }}
      className="mx-0.5 inline-flex max-w-[12rem] select-none items-center gap-1 truncate rounded-md px-1.5 py-0.5 align-baseline text-xs"
      style={{
        background: 'color-mix(in srgb, var(--accent) 13%, var(--shelf))',
        color: 'var(--accent)',
      }}
    >
      <span title={element.label}>{element.label}</span>
      {props.children}
    </PlateElement>
  );
}

function insertReferenceNode(
  editor: ComposerEditor,
  selection: ChatSelectionAttachment,
) {
  focusComposerEnd(editor);
  editor.tf.insertNodes({
    type: REFERENCE_TYPE,
    refId: selection.id,
    label: formatSelectionLabel(selection),
    children: [{ text: '' }],
  } as TElement, { select: false });
  editor.tf.insertText(' ');
  focusComposerEnd(editor);
}

function removeReferenceNode(editor: ComposerEditor, id: string) {
  editor.tf.removeNodes({
    at: [],
    match: (node: unknown) =>
      NodeApi.isNode(node) &&
      !NodeApi.isEditor(node) &&
      'type' in node &&
      node.type === REFERENCE_TYPE &&
      'refId' in node &&
      node.refId === id,
  });
}

function updateReferenceLabel(
  editor: ComposerEditor,
  id: string,
  label: string,
) {
  editor.tf.setNodes(
    { label },
    {
      at: [],
      match: (node: unknown) =>
        NodeApi.isNode(node) &&
        !NodeApi.isEditor(node) &&
        'type' in node &&
        node.type === REFERENCE_TYPE &&
        'refId' in node &&
        node.refId === id,
    },
  );
}

/**
 * readComposerText —— 从编辑器 AST 提取纯文本（跳过 chips 引用 token）。
 *
 * v3 协议：chips 的引用内容由 formatReferencesAsMd 单独拼接，
 * 此函数只负责从 contenteditable AST 里读用户输入的文字部分。
 * 引用 token（REFERENCE_TYPE void node）不展开成文本，直接跳过。
 */
function readComposerText(nodes: Descendant[]): string {
  const chunks: string[] = [];

  const visit = (node: Descendant) => {
    if ('text' in node) {
      chunks.push(typeof node.text === 'string' ? node.text : '');
      return;
    }
    if (node.type === REFERENCE_TYPE) {
      // v3：chips 已由 formatReferencesAsMd 处理，此处直接跳过 token
      return;
    }
    node.children.forEach(visit);
    chunks.push('\n');
  };

  nodes.forEach(visit);
  return chunks.join('');
}

/**
 * @deprecated v2 兼容保留——外部如有调用先不破坏签名；v3 内部改用 readComposerText + formatReferencesAsMd。
 * Task 10 统一清旧时删。
 *
 * 第三个参数 attachmentsById 在 v3 中已不再需要（chips 由 formatReferencesAsMd 处理），
 * 保留签名兼容是为了让现有调用方（测试）不需要同步改签名。
 */
export function readComposerPayload(
  nodes: Descendant[],
  selections: ChatSelectionAttachment[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _attachmentsById: ReadonlyMap<string, ChatSelectionAttachment> = new Map(),
): ComposerPayload {
  // v3 协议：chips 拼 markdown 引用块，references 字段已从 ComposerPayload 移除
  const text = readComposerText(nodes) + formatReferencesAsMd(selections);
  return { text };
}

function getReferenceIds(nodes: Descendant[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: Descendant) => {
    if ('text' in node) return;
    if (node.type === REFERENCE_TYPE && typeof node.refId === 'string') {
      ids.add(node.refId);
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

function isComposerEmpty(nodes: Descendant[]): boolean {
  if (getReferenceIds(nodes).size > 0) return false;
  return nodes.map((node) => NodeApi.string(node)).join('').trim().length === 0;
}

function formatSelectionLabel(selection: ChatSelectionAttachment): string {
  return formatParagraphRange(selection.getAnchor());
}

function cloneEmptyValue(): Descendant[] {
  return [{ type: 'p', children: [{ text: '' }] } as Descendant];
}

function focusComposerEnd(editor: ComposerEditor) {
  ensureTrailingText(editor);
  const lastBlockIndex = Math.max(0, editor.children.length - 1);
  const lastBlock = editor.children[lastBlockIndex];
  const lastChildIndex =
    lastBlock && 'children' in lastBlock
      ? Math.max(0, lastBlock.children.length - 1)
      : 0;
  const lastChild =
    lastBlock && 'children' in lastBlock
      ? lastBlock.children[lastChildIndex]
      : undefined;
  const offset = lastChild && 'text' in lastChild && typeof lastChild.text === 'string'
    ? lastChild.text.length
    : 0;
  editor.tf.select({ path: [lastBlockIndex, lastChildIndex], offset });
  editor.tf.focus();
}

function ensureTrailingText(editor: ComposerEditor) {
  const lastBlockIndex = Math.max(0, editor.children.length - 1);
  const lastBlock = editor.children[lastBlockIndex];
  if (!lastBlock || !('children' in lastBlock)) return;

  const children = lastBlock.children;
  const lastChildIndex = children.length - 1;
  const lastChild = children[lastChildIndex];
  if (lastChild && 'text' in lastChild) return;

  editor.tf.insertNodes(
    { text: '' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate insertNodes at 类型不接受 [block, child] 元组
    { at: [lastBlockIndex, children.length], select: false } as any,
  );
}

function formatParagraphRange(anchor: AnchorPayload): string {
  if (anchor.type !== 'range') return '片段';
  const start = anchor.startPath?.[0] ?? anchor.blockIndex;
  const end = anchor.endPath?.[0] ?? start;
  const from = Math.min(start, end) + 1;
  const to = Math.max(start, end) + 1;
  return from === to ? `第 ${from} 段` : `第 ${from}-${to} 段`;
}
