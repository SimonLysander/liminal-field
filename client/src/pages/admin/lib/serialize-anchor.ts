import { NodeApi, type Descendant } from 'platejs';

/**
 * serializeAnchor —— 把 editor.selection 序列化成 transport 可发的锚点对象。
 *
 * v2 改稿的"定位"靠它:前端把当前选区/光标位置序列化,经聊天 transport 传给后端;
 * 后端 prompt.handler 据此注入 <selection> / <cursor> 节,Aurora 看着锚点选三
 * 工具之一(rewrite_selection / insert_at_cursor / rewrite_document)。
 * 模型不再"自己找位置"。
 *
 * textPreview:选区情况下取【起点块】的纯文本前 40 字(简化:不取真实选区文字,
 * 因跨叶子/跨块选区难取且对模型理解足够),给后端拼 prompt 用——让模型知道
 * "被选中的大概是什么内容"。
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

export function serializeAnchor(
  blocks: Descendant[],
  selection: AnchorRange | null,
): AnchorPayload {
  if (!selection) return { type: 'none' };

  const { anchor, focus } = selection;
  const startBlockIdx = anchor.path[0] ?? 0;

  // 折叠选区 = 光标态（anchor === focus：同 path 同 offset）
  const collapsed =
    JSON.stringify(anchor.path) === JSON.stringify(focus.path) &&
    anchor.offset === focus.offset;

  if (collapsed) {
    return { type: 'cursor', blockIndex: startBlockIdx, startPath: anchor.path };
  }

  // range：textPreview 策略
  //   单块选区（anchor/focus 在同一顶层块）：直接取 offset 区间的真实选区文字，超 40 字截断
  //   跨块选区：跨叶子的真实文字难以反算，退化为起点块纯文本前 40 字——给模型定位上下文足够
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
