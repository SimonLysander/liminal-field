import { KEYS } from 'platejs';
import {
  CheckSquareIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  QuoteIcon,
} from 'lucide-react';

export type TurnIntoItem = {
  type: string;
  label: string;
  Icon: typeof Heading1Icon;
};

export const TEXT_BLOCK_TYPES = new Set<string>([
  KEYS.p,
  KEYS.h1,
  KEYS.h2,
  KEYS.h3,
  KEYS.h4,
  KEYS.h5,
  KEYS.h6,
  KEYS.blockquote,
]);

export const LIST_BLOCK_TYPES = new Set<string>([
  KEYS.ul,
  KEYS.ol,
  KEYS.listTodo,
]);

export const TURN_INTO_TEXT_LIST_TYPES = new Set<string>([
  KEYS.p,
  KEYS.h1,
  KEYS.h2,
  KEYS.h3,
  KEYS.blockquote,
  KEYS.ul,
  KEYS.ol,
  KEYS.listTodo,
]);

// 文本 + 列表 — 这 8 项互转安全
const TEXT_AND_LIST_ITEMS: TurnIntoItem[] = [
  { type: KEYS.p, label: '段落', Icon: PilcrowIcon },
  { type: KEYS.h1, label: '一级标题', Icon: Heading1Icon },
  { type: KEYS.h2, label: '二级标题', Icon: Heading2Icon },
  { type: KEYS.h3, label: '三级标题', Icon: Heading3Icon },
  { type: KEYS.blockquote, label: '引用', Icon: QuoteIcon },
  { type: KEYS.ul, label: '无序列表', Icon: ListIcon },
  { type: KEYS.ol, label: '有序列表', Icon: ListOrderedIcon },
  { type: KEYS.listTodo, label: '待办', Icon: CheckSquareIcon },
];

// 代码块的退路：只暴露"段落"。其他块型（标题/列表/引用）从代码块直转
// 仍然是结构跨度太大的边界场景，先不开。
const CODE_BLOCK_ESCAPE_ITEMS: TurnIntoItem[] = [
  { type: KEYS.p, label: '段落', Icon: PilcrowIcon },
];

export const isTextOrListBlockType = (type: string) =>
  TEXT_BLOCK_TYPES.has(type) || LIST_BLOCK_TYPES.has(type);

export const canShowTurnInto = (currentType: string) =>
  currentType === KEYS.codeBlock || isTextOrListBlockType(currentType);

export const getTurnIntoItems = (currentType: string): TurnIntoItem[] => {
  if (currentType === KEYS.codeBlock) {
    return CODE_BLOCK_ESCAPE_ITEMS;
  }

  if (canShowTurnInto(currentType)) {
    return TEXT_AND_LIST_ITEMS;
  }

  return [];
};

export const canTurnInto = (currentType: string) =>
  getTurnIntoItems(currentType).length > 0;

export const getTurnIntoTypes = (currentType: string) =>
  getTurnIntoItems(currentType).map((item) => item.type);

export const canSetTopLevelBlockType = (
  currentType: string,
  nextType: string,
) => {
  if (!isTextOrListBlockType(currentType)) {
    return false;
  }

  return TURN_INTO_TEXT_LIST_TYPES.has(nextType);
};
