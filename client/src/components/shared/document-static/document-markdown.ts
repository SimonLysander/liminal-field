import { deserializeMd } from '@platejs/markdown';
import type { SlateEditor, TElement, Value } from 'platejs';

import { fixCodeBlockLines } from '@/components/shared/plate-transforms';

type DocumentNode = {
  children?: DocumentNode[];
  text?: string;
  [key: string]: unknown;
};

const DATE_TAG_RE = /<date\s+value="([^"]+)"\s*\/>/g;
const DATE_PLACEHOLDER_RE = /%%DATE:([^%]+)%%/g;

export function preprocessDocumentMarkdown(markdown: string): string {
  return markdown.replace(DATE_TAG_RE, '%%DATE:$1%%');
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

      let cursor = 0;
      for (const match of child.text.matchAll(DATE_PLACEHOLDER_RE)) {
        const matchIndex = match.index;
        if (matchIndex > cursor) {
          children.push({ ...child, text: child.text.slice(cursor, matchIndex) });
        }
        children.push({
          type: 'date',
          date: match[1],
          children: [{ text: '' }],
        });
        cursor = matchIndex + match[0].length;
      }

      if (cursor === 0) {
        children.push(child);
      } else if (cursor < child.text.length) {
        children.push({ ...child, text: child.text.slice(cursor) });
      }
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
    // 正文可能包含敏感内容；异常日志只记录解析器错误，不附带 Markdown。
    console.error('[document-markdown] Markdown parsing failed', error);
    return [{ type: 'p', children: [{ text: markdown }] }];
  }
}
