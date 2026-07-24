import { deserializeMd } from '@platejs/markdown';
import type { SlateEditor, TElement, Value } from 'platejs';

import { preprocessMarkdownForPlate } from '@/components/shared/markdown-preprocess';
import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
import { createLogger } from '@/lib/logger';

type DocumentNode = {
  children?: DocumentNode[];
  text?: string;
  [key: string]: unknown;
};

type StaticListContext = {
  indent: number;
  list: DocumentNode;
};

const DATE_TAG_RE = /<date\s+value="([^"]+)"\s*\/>/g;
const DATE_MARKER_START = '\uE000';
const DATE_MARKER_END = '\uE001';
const DATE_MARKER_PREFIX = `${DATE_MARKER_START}DATE:`;
const logger = createLogger('document-markdown');

export function preprocessDocumentMarkdown(markdown: string): string {
  // 先双写原文中的私有起始符，保证只有本次替换产生的单起始符能被还原为 date。
  return preprocessMarkdownForPlate(markdown)
    .replaceAll(DATE_MARKER_START, `${DATE_MARKER_START}${DATE_MARKER_START}`)
    .replace(DATE_TAG_RE, (_, date: string) => {
      return `${DATE_MARKER_PREFIX}${encodeURIComponent(date)}${DATE_MARKER_END}`;
    });
}

function restoreDateMarkers(textNode: DocumentNode & { text: string }): DocumentNode[] {
  const restored: DocumentNode[] = [];
  let text = '';
  let cursor = 0;

  const flushText = () => {
    if (text !== '') restored.push({ ...textNode, text });
    text = '';
  };

  while (cursor < textNode.text.length) {
    if (!textNode.text.startsWith(DATE_MARKER_START, cursor)) {
      text += textNode.text[cursor];
      cursor += 1;
      continue;
    }
    if (textNode.text.startsWith(`${DATE_MARKER_START}${DATE_MARKER_START}`, cursor)) {
      text += DATE_MARKER_START;
      cursor += 2;
      continue;
    }
    if (!textNode.text.startsWith(DATE_MARKER_PREFIX, cursor)) {
      text += DATE_MARKER_START;
      cursor += 1;
      continue;
    }

    const valueStart = cursor + DATE_MARKER_PREFIX.length;
    const markerEnd = textNode.text.indexOf(DATE_MARKER_END, valueStart);
    if (markerEnd === -1) {
      text += DATE_MARKER_START;
      cursor += 1;
      continue;
    }

    flushText();
    restored.push({
      type: 'date',
      date: decodeURIComponent(textNode.text.slice(valueStart, markerEnd)),
      children: [{ text: '' }],
    });
    cursor = markerEnd + DATE_MARKER_END.length;
  }

  flushText();
  return restored.length > 0 ? restored : [{ ...textNode, text: '' }];
}

function restoreDatePlaceholders(nodes: DocumentNode[]): DocumentNode[] {
  return nodes.map((node) => {
    if (!node.children) return node;

    const children: DocumentNode[] = [];
    for (const child of node.children) {
      if (child.text === undefined) {
        children.push(child.children ? restoreDatePlaceholders([child])[0] : child);
        continue;
      }
      children.push(...restoreDateMarkers(child as DocumentNode & { text: string }));
    }

    return { ...node, children };
  });
}

function isListParagraph(node: DocumentNode): boolean {
  return node.type === 'p' && typeof node.listStyleType === 'string';
}

function getListIndent(node: DocumentNode): number {
  const indent = node.indent;

  return typeof indent === 'number' && Number.isFinite(indent) && indent > 0
    ? Math.floor(indent)
    : 1;
}

function createStaticList(node: DocumentNode): DocumentNode {
  const list: DocumentNode = {
    type: 'static_list',
    listStyleType: node.listStyleType,
    children: [],
  };

  if (typeof node.listStart === 'number') list.listStart = node.listStart;

  return list;
}

function createStaticListItem(node: DocumentNode): DocumentNode {
  const item: DocumentNode = {
    type: 'static_list_item',
    children: node.children ?? [{ text: '' }],
  };

  if (node.listStyleType === 'todo') item.checked = node.checked === true;

  return item;
}

function appendStaticList(
  list: DocumentNode,
  parent: StaticListContext | undefined,
  roots: DocumentNode[],
): void {
  if (!parent) {
    roots.push(list);
    return;
  }

  const parentItems = parent.list.children ?? [];
  const parentItem = parentItems.at(-1);

  if (!parentItem) {
    roots.push(list);
    return;
  }

  parentItem.children ??= [];
  parentItem.children.push(list);
}

function normalizeListRun(nodes: DocumentNode[]): DocumentNode[] {
  const roots: DocumentNode[] = [];
  const stack: StaticListContext[] = [];

  for (const node of nodes) {
    const indent = getListIndent(node);
    const listStyleType = node.listStyleType;

    while (stack.length > 0 && indent < stack.at(-1)!.indent) stack.pop();

    let current = stack.at(-1);
    if (current?.indent === indent && current.list.listStyleType !== listStyleType) {
      stack.pop();
      current = stack.at(-1);
    }

    if (!current || current.indent !== indent || current.list.listStyleType !== listStyleType) {
      const list = createStaticList(node);
      appendStaticList(list, current, roots);
      current = { indent, list };
      stack.push(current);
    }

    current.list.children!.push(createStaticListItem(node));
  }

  return roots;
}

/**
 * Markdown deserializes indent-based list paragraphs. Static rendering needs
 * real list containers, so this transient conversion keeps Markdown as the
 * stored format while producing semantic list nodes for the reader only.
 */
function normalizeStaticLists(nodes: DocumentNode[]): DocumentNode[] {
  const normalized = nodes.map((node) =>
    node.children ? { ...node, children: normalizeStaticLists(node.children) } : node,
  );
  const result: DocumentNode[] = [];

  for (let index = 0; index < normalized.length; ) {
    const node = normalized[index];
    if (!isListParagraph(node)) {
      result.push(node);
      index += 1;
      continue;
    }

    const run: DocumentNode[] = [];
    while (index < normalized.length && isListParagraph(normalized[index])) {
      run.push(normalized[index]);
      index += 1;
    }
    result.push(...normalizeListRun(run));
  }

  return result;
}

export function normalizeDocumentNodes(nodes: TElement[]): TElement[] {
  const restored = restoreDatePlaceholders(nodes as DocumentNode[]) as TElement[];
  return fixCodeBlockLines(normalizeStaticLists(restored as DocumentNode[]) as TElement[]);
}

export function deserializeDocumentMarkdown(
  editor: SlateEditor,
  markdown: string,
): Value {
  try {
    const nodes = deserializeMd(editor, preprocessDocumentMarkdown(markdown));
    return normalizeDocumentNodes(nodes as TElement[]);
  } catch (error) {
    // 第三方错误的 message/stack 可能回显正文，因此只记录固定分类与长度。
    logger.error('markdown_parse_failed', {
      errorType: error instanceof Error ? 'Error' : 'Unknown',
      markdownLength: markdown.length,
    });
    return [{ type: 'p', children: [{ text: markdown }] }];
  }
}
