import { clearEditorTextHighlight, highlightTextInContainer } from '@/hooks/use-selected-text';
import { NodeApi, type Descendant } from 'platejs';

/**
 * AnchorRange / AnchorPayload / serializeAnchor ——
 * 原 serialize-anchor.ts(已删)中的类型和函数迁移至此。
 * 唯一用户是 live-chat-selection 自身和 PlateEditor 的 AnchorBridge。
 */
export interface AnchorRange {
  anchor: { path: number[]; offset: number };
  focus: { path: number[]; offset: number };
}

export type AnchorPayload =
  | { type: 'none' }
  | { type: 'cursor'; blockIndex: number; startPath: number[] }
  | {
      type: 'range';
      blockIndex: number;
      startPath: number[];
      endPath: number[];
      textPreview?: string;
    };

/** 选区 textPreview 最大字符数 */
const PREVIEW_LEN = 40;

/**
 * serializeAnchor —— 把 editor.selection 序列化成 transport 可发的锚点对象。
 * 用于 AnchorBridge 把 Plate selection 上报给父层；v3 transport 不再使用此值。
 */
export function serializeAnchor(
  blocks: Descendant[],
  selection: AnchorRange | null,
): AnchorPayload {
  if (!selection) return { type: 'none' };

  const { anchor, focus } = selection;
  const startBlockIdx = anchor.path[0] ?? 0;

  const collapsed =
    JSON.stringify(anchor.path) === JSON.stringify(focus.path) && anchor.offset === focus.offset;

  if (collapsed) {
    return { type: 'cursor', blockIndex: startBlockIdx, startPath: anchor.path };
  }

  const block = blocks[startBlockIdx];
  const text = block ? NodeApi.string(block) : '';
  const isSameBlock = anchor.path[0] === focus.path[0];
  const textPreview = isSameBlock
    ? text.slice(anchor.offset, focus.offset).slice(0, PREVIEW_LEN)
    : text.slice(0, PREVIEW_LEN);

  return {
    type: 'range',
    blockIndex: startBlockIdx,
    startPath: anchor.path,
    endPath: focus.path,
    textPreview,
  };
}

export interface ChatSelectionAttachment {
  id: string;
  /** 引用来源:'draft'=编辑器草稿划词;'aurora'=聊天里引用 Aurora 的话。决定 chip 标签与发送格式。 */
  kind?: 'draft' | 'aurora';
  /** 引用到 Aurora 时的短预览，只用于 chip 展示，不作为发送内容。 */
  preview: string;
  /** 发送瞬间从 live range 读取当前正文。 */
  getText: () => string;
  /** 发送瞬间把 live range 序列化为 transport anchor。 */
  getAnchor: () => AnchorPayload;
  highlight: (opts?: { scroll?: boolean }) => boolean;
  clearHighlight: () => void;
  dispose: () => void;
}

export interface ChatReferenceSnapshot {
  id: string;
  order: number;
  text: string;
  preview: string;
  anchor: AnchorPayload;
}

export interface ChatReferencesMetadata {
  references?: ChatReferenceSnapshot[];
}

interface LiveRangeRef {
  current: AnchorRange | null;
  unref: () => AnchorRange | null;
}

export interface LiveSelectionEditor {
  children: Descendant[];
  selection: AnchorRange | null;
  api: {
    rangeRef: (
      range: AnchorRange,
      options?: { affinity?: 'forward' | 'backward' | 'outward' | 'inward' | null },
    ) => LiveRangeRef;
    after: (
      at: AnchorRange['anchor'],
      options?: { distance?: number; unit?: 'character' },
    ) => AnchorRange['anchor'] | undefined;
    start: (at: number[]) => AnchorRange['anchor'] | undefined;
    end: (at: number[]) => AnchorRange['focus'] | undefined;
    string: (at?: AnchorRange | null) => string;
    toDOMRange: (range: AnchorRange) => Range | undefined;
    /** 取选区的 fragment(块节点数组)。用于按块拼文本以保留块间换行。可选:缺省时 getText 回退 api.string。 */
    fragment?: (at: AnchorRange) => Descendant[];
  };
}

/**
 * fragmentToText —— 把选区 fragment 逐块拼成带换行的文本。
 *
 * 为什么不用 editor.api.string / Range.toString:两者都只拼文本节点、不在块边界插换行,
 * 导致引用多段草稿/代码时换行全丢。这里逐块取文本、块间用 \n 连;代码块特判按行连。
 */
function fragmentToText(fragment: Descendant[]): string {
  const escapeTableCell = (text: string) =>
    text.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();

  const tableToMarkdown = (node: Descendant): string => {
    if (!('children' in node) || !Array.isArray(node.children)) {
      return NodeApi.string(node);
    }

    const rows = node.children
      .filter((row) => row.type === 'tr' && Array.isArray(row.children))
      .map((row) =>
        (row.children as Descendant[])
          .filter(
            (cell) => (cell.type === 'td' || cell.type === 'th') && Array.isArray(cell.children),
          )
          .map((cell) => escapeTableCell(NodeApi.string(cell))),
      )
      .filter((row) => row.length > 0);

    if (rows.length === 0) return NodeApi.string(node);

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => row[index] ?? ''),
    );
    const [firstRow, ...bodyRows] = normalizedRows;
    const separator = Array.from({ length: columnCount }, () => '---');
    const renderRow = (row: string[]) => `| ${row.join(' | ')} |`;

    return [renderRow(firstRow), renderRow(separator), ...bodyRows.map(renderRow)].join('\n');
  };

  const nodeToText = (node: Descendant): string => {
    if ('text' in node) return typeof node.text === 'string' ? node.text : '';
    // 代码块:子节点是各代码行,逐行用 \n 连(NodeApi.string 会把行拼成一坨)
    if (node.type === 'code_block' && Array.isArray(node.children)) {
      return node.children.map((line) => NodeApi.string(line)).join('\n');
    }
    if (node.type === 'table') {
      return tableToMarkdown(node);
    }
    // 段落/标题等单块:取其文本(行内拼接,无块间换行——本就是一块)
    return NodeApi.string(node);
  };
  return fragment.map(nodeToText).join('\n');
}

let activeHighlight: Highlight | undefined;

function clearChatSelectionHighlight() {
  if (!('highlights' in CSS)) return;
  CSS.highlights.delete('chat-selection');
  activeHighlight = undefined;
}

export function createLiveChatSelectionAttachment({
  editor,
  preview,
}: {
  editor: LiveSelectionEditor;
  preview: string;
}): ChatSelectionAttachment | undefined {
  const initialRange = editor.selection;
  if (!initialRange) return undefined;

  const contextualRange =
    getContainingSentenceRange(editor, initialRange) ??
    getContainingBlockLineRange(editor, initialRange) ??
    initialRange;
  const rangeRef = editor.api.rangeRef(contextualRange, { affinity: 'outward' });
  const initialPreview = editor.api.string(contextualRange).trim() || preview.trim();
  const initialAnchor = serializeAnchor(editor.children, contextualRange);
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `chat-selection-${Date.now()}`;

  return {
    id,
    kind: 'draft',
    preview: initialPreview,
    getText: () => {
      const range = rangeRef.current;
      if (!range) return initialPreview;
      // 逐块拼文本以保留块间换行(api.string / Range.toString 都不插块间换行 → 草稿多段会丢换行)。
      const frag = editor.api.fragment?.(range);
      const text = Array.isArray(frag) ? fragmentToText(frag).trim() : '';
      return text || editor.api.string(range).trim();
    },
    getAnchor: () => {
      const range = rangeRef.current;
      return range ? serializeAnchor(editor.children, range) : initialAnchor;
    },
    highlight: (opts = {}) => {
      const range = rangeRef.current;
      if (!range || !('highlights' in CSS)) return false;
      const domRange = editor.api.toDOMRange(range);
      if (!domRange) return false;

      activeHighlight = new Highlight(domRange);
      CSS.highlights.set('chat-selection', activeHighlight);
      if (opts.scroll) {
        domRange.startContainer.parentElement?.scrollIntoView({
          block: 'center',
          behavior: 'smooth',
        });
      }
      return true;
    },
    clearHighlight: clearChatSelectionHighlight,
    dispose: () => {
      clearChatSelectionHighlight();
      rangeRef.unref();
    },
  };
}

/**
 * createChatMessageAttachment —— 从「Aurora 的话」(聊天消息划词)建引用附件。
 *
 * 跟草稿引用不同:聊天消息是静态展示 DOM(非 Plate 编辑器、内容不再变),所以这是个
 * 静态快照——getText 直接返回划词文本,无 live range、无高亮/dispose。复用同一个
 * ChatSelectionAttachment 接口,塞进同一个 chips 数组,发送/删除/清空逻辑全共用。
 */
export function createChatMessageAttachment({ text }: { text: string }): ChatSelectionAttachment {
  const clean = text.trim();
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `chat-message-${Date.now()}`;
  return {
    id,
    kind: 'aurora',
    preview: clean.slice(0, 40),
    getText: () => clean,
    getAnchor: () => ({ type: 'none' }),
    // 点 chip 时:在聊天消息容器里按文本找到原句,滚动 + 高亮(复用编辑器那套 CSS Highlight)。
    highlight: (opts = {}) =>
      highlightTextInContainer('[data-chat-messages]', clean, { scroll: opts.scroll }),
    clearHighlight: clearEditorTextHighlight,
    dispose: clearEditorTextHighlight,
  };
}

function getContainingBlockLineRange(
  editor: LiveSelectionEditor,
  range: AnchorRange,
): AnchorRange | undefined {
  const anchorBlock = range.anchor.path[0];
  const focusBlock = range.focus.path[0];
  if (anchorBlock === undefined || focusBlock === undefined) return undefined;

  const startBlock = Math.min(anchorBlock, focusBlock);
  const endBlock = Math.max(anchorBlock, focusBlock);
  const anchor = editor.api.start([startBlock]);
  const focus = editor.api.end([endBlock]);
  if (!anchor || !focus) return undefined;

  return { anchor, focus };
}

const SENTENCE_BOUNDARY_RE = /[。！？!?；;]/;

function getContainingSentenceRange(
  editor: LiveSelectionEditor,
  range: AnchorRange,
): AnchorRange | undefined {
  if (range.anchor.path[0] !== range.focus.path[0]) return undefined;

  const blockIndex = range.anchor.path[0];
  if (blockIndex === undefined) return undefined;

  const blockStart = editor.api.start([blockIndex]);
  const blockEnd = editor.api.end([blockIndex]);
  if (!blockStart || !blockEnd) return undefined;

  const blockRange = { anchor: blockStart, focus: blockEnd };
  const blockText = editor.api.string(blockRange);
  if (!blockText.trim()) return undefined;

  const anchorOffset = editor.api.string({ anchor: blockStart, focus: range.anchor }).length;
  const focusOffset = editor.api.string({ anchor: blockStart, focus: range.focus }).length;
  const selectedStart = Math.min(anchorOffset, focusOffset);
  const selectedEnd = Math.max(anchorOffset, focusOffset);

  const sentenceStart = findSentenceStart(blockText, selectedStart);
  const sentenceEnd = findSentenceEnd(blockText, selectedEnd);
  if (sentenceStart === sentenceEnd) return undefined;

  const anchor = pointAtBlockOffset(editor, blockStart, sentenceStart);
  const focus = pointAtBlockOffset(editor, blockStart, sentenceEnd);
  if (!anchor || !focus) return undefined;

  return { anchor, focus };
}

function findSentenceStart(text: string, offset: number): number {
  for (let i = Math.max(0, offset - 1); i >= 0; i -= 1) {
    if (SENTENCE_BOUNDARY_RE.test(text[i])) {
      return skipLeadingWhitespace(text, i + 1);
    }
  }
  return skipLeadingWhitespace(text, 0);
}

function findSentenceEnd(text: string, offset: number): number {
  for (let i = Math.max(0, offset); i < text.length; i += 1) {
    if (SENTENCE_BOUNDARY_RE.test(text[i])) {
      return i + 1;
    }
  }
  return trimTrailingWhitespaceOffset(text, text.length);
}

function skipLeadingWhitespace(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function trimTrailingWhitespaceOffset(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  return i;
}

function pointAtBlockOffset(
  editor: LiveSelectionEditor,
  blockStart: AnchorRange['anchor'],
  offset: number,
): AnchorRange['anchor'] | undefined {
  if (offset <= 0) return blockStart;
  return editor.api.after(blockStart, { distance: offset, unit: 'character' });
}
