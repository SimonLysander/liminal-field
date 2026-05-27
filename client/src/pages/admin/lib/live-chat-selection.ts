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
    JSON.stringify(anchor.path) === JSON.stringify(focus.path) &&
    anchor.offset === focus.offset;

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
  /** 添加到聊天时的短预览，只用于 chip 展示，不作为发送内容。 */
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
  };
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
    preview: initialPreview,
    getText: () => {
      const range = rangeRef.current;
      return range ? editor.api.string(range).trim() : initialPreview;
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
