import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { replaceSlashTokenInText } from './slash-text-utils';

const REFERENCE_TYPE = 'chat_reference';

/**
 * referenceChipLabel —— 输入框 chip 的显示标签:草稿给"第N段"(位置),会话给内容预览
 * (位置对会话无意义,内容才是定位线索;点 chip 还能滚回原文高亮)。
 *
 * 注:这只是 chip 的"显示"标签;发给模型的不是它——顺序式下 chip 在正文里**原地展开成
 * 「内容」**(见 readComposerText),位置即语义,所以不再需要"草稿·第N段"这种来源前缀进上下文。
 */
function referenceChipLabel(ref: ChatSelectionAttachment): string {
  if (ref.kind === 'aurora') {
    const t = (ref.getText() || ref.preview).replace(/\s+/g, ' ').trim();
    return `会话·${t.slice(0, 12)}${t.length > 12 ? '…' : ''}`;
  }
  return `草稿·${formatParagraphRange(ref.getAnchor())}`;
}

type ReferenceElement = TElement & {
  refId: string;
  label: string;
  /** 引用的全文,只用于 chip 的 hover tooltip(title);发送内容仍走 attachment.getText()。 */
  content?: string;
};
type ComposerEditor = NonNullable<ReturnType<typeof usePlateEditor>>;

/** 发送瞬间冻结的内联引用:content 已就地展开进 text(给模型按位置读),label 给气泡渲染回 chip。 */
export interface InlineRef {
  content: string;
  label: string;
}

/**
 * readAndClear 返回:
 * - text:chip 已在原位展开成「content」的发送文本(模型看到内容+位置)。
 * - references:按出现顺序的引用,作为 metadata 随消息走,仅供气泡把「content」渲染回紧凑 chip
 *   (显示层和输入框形态保持一致),不影响模型看到的 text。
 */
export interface ComposerPayload {
  text: string;
  references: InlineRef[];
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

  const editor = usePlateEditor(
    {
      plugins: [ReferenceTokenPlugin],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate Value 类型与 Descendant[] 不兼容，需要强制转换
      value: () => cloneEmptyValue() as any,
    },
    [],
  )!;

  useImperativeHandle(
    ref,
    () => ({
      readAndClear: (): ComposerPayload => {
        // 顺序式:遍历 AST,chip 在其所在位置原地展开成「发送瞬间的内容」——位置即语义,
        // 引用就嵌在用户指代它的地方,不再统一甩到末尾(锚点式丢了"这段/那段"的指代绑定)。
        const references: InlineRef[] = [];
        const text = readComposerText(editor.children, (refId) => {
          const att = attachmentByIdRef.current.get(refId);
          if (!att) return '';
          const content = att.getText() || att.preview;
          // 按 AST 遍历顺序收集 → references 与 text 里「content」出现顺序天然一致。
          references.push({ content, label: formatSelectionLabel(att) });
          return content;
        });
        // 清 editor（含引用 token）+ 关联映射
        editor.tf.reset();
        insertedIdsRef.current.clear();
        attachmentByIdRef.current.clear();
        queueMicrotask(() => focusComposerEnd(editor));
        onEmptyChange?.(true);
        return { text, references };
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
        updateReferenceNode(
          editor,
          selection.id,
          formatSelectionLabel(selection),
          selection.getText() || selection.preview,
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
        // IME（中文输入法）输入期间不拦截任何 key —— Windows IME 严格按
        // composition 状态走，keydown 阶段 preventDefault 会打断候选窗口，
        // 用户必须按两次标点 / Enter 才能落字。Mac 上 IME 实现宽松所以
        // 没暴露，Windows 暴露。`isComposing` 是 W3C 标准、所有现代浏
        // 览器支持。下面所有自定义 keydown 都需要这条守卫。
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSubmit?.();
        }
      },
      // 点 chip → 滚到引用原文并高亮(草稿滚编辑器 / 会话滚聊天消息,各自 attachment.highlight 实现)。
      // chip 是 void 节点,用 mousedown + preventDefault 防止点击移动光标 / 选中节点。
      onMouseDown: (event: MouseEvent<HTMLDivElement>) => {
        const chip = (event.target as HTMLElement).closest('[data-ref-id]');
        if (!chip) return;
        event.preventDefault();
        const id = chip.getAttribute('data-ref-id');
        if (id) attachmentByIdRef.current.get(id)?.highlight({ scroll: true });
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
        onMouseDown={editableProps.onMouseDown}
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
      {/* hover 用 HoverCard 显示引用全文(纸感卡,比原生 title 即时、好看) */}
      <HoverCard openDelay={150} closeDelay={100}>
        <HoverCardTrigger asChild>
          <span>{element.label}</span>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          sideOffset={6}
          // 用组件默认的 popover 外观(opaque + 边框 + 阴影),只定制尺寸/内边距/字号/换行。
          className="w-auto max-w-[280px] p-2.5 text-xs leading-relaxed"
          style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}
        >
          {element.content || element.label}
        </HoverCardContent>
      </HoverCard>
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
    content: selection.getText() || selection.preview,
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

function updateReferenceNode(
  editor: ComposerEditor,
  id: string,
  label: string,
  content: string,
) {
  editor.tf.setNodes(
    { label, content },
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
 * readComposerText —— 从编辑器 AST 提取发送文本,chip 原地展开成「内容」(顺序式)。
 *
 * 顺序式:遇到引用 token(REFERENCE_TYPE void node),在它所在位置就地吐出「内容」,
 * 内容由 resolveRef(refId) 在发送瞬间解析(读 live 文本)。这样引用就嵌在用户指代它的
 * 地方,模型读到"这段「…」和那段「…」"时,指代绑定是确定的,不用回末尾猜映射。
 * 不传 resolveRef 时(理论上不会),token 静默跳过。
 */
function readComposerText(
  nodes: Descendant[],
  resolveRef?: (refId: string) => string,
): string {
  const chunks: string[] = [];

  const visit = (node: Descendant) => {
    if ('text' in node) {
      chunks.push(typeof node.text === 'string' ? node.text : '');
      return;
    }
    if (node.type === REFERENCE_TYPE) {
      const refId = typeof node.refId === 'string' ? node.refId : '';
      const content = resolveRef?.(refId)?.trim();
      if (content) chunks.push(`「${content}」`);
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
  // 顺序式:chip 在 AST 里原地展开成「内容」;按 selections 的 id 解析,同时按序收集 references。
  const byId = new Map(selections.map((s) => [s.id, s]));
  const references: InlineRef[] = [];
  const text = readComposerText(nodes, (refId) => {
    const att = byId.get(refId);
    if (!att) return '';
    const content = att.getText() || att.preview;
    references.push({ content, label: formatSelectionLabel(att) });
    return content;
  });
  return { text, references };
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
  return referenceChipLabel(selection);
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
