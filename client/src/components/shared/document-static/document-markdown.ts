import { deserializeMd } from '@platejs/markdown';
import type { SlateEditor, TElement, Value } from 'platejs';

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';
import { createLogger } from '@/lib/logger';

type DocumentNode = {
  children?: DocumentNode[];
  text?: string;
  [key: string]: unknown;
};

const DATE_TAG_RE = /<date\s+value="([^"]+)"\s*\/>/g;
const DATE_MARKER_START = '\uE000';
const DATE_MARKER_END = '\uE001';
const DATE_MARKER_PREFIX = `${DATE_MARKER_START}DATE:`;
const logger = createLogger('document-markdown');

export function preprocessDocumentMarkdown(markdown: string): string {
  // 先双写原文中的私有起始符，保证只有本次替换产生的单起始符能被还原为 date。
  return markdown
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

export function normalizeDocumentNodes(nodes: TElement[]): TElement[] {
  const restored = restoreDatePlaceholders(nodes as DocumentNode[]) as TElement[];
  return fixCodeBlockLines(restored);
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
