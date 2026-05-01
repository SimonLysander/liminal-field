/**
 * Markdown 工具函数
 *
 * extractHeadings：从 markdown 字符串提取标题，纯函数，不碰 DOM。
 * 使用 remark 解析 AST，和 react-markdown / MarkdownBody 共用同一套解析器，
 * 保证标题识别结果一致。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Heading, PhrasingContent, RootContent } from 'mdast';

export type TocEntry = { level: number; text: string; index: number };

const parser = unified().use(remarkParse).use(remarkGfm);

/** 从 AST phrasing 节点递归提取纯文本 */
function phrasingToText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => ('value' in n ? n.value : 'children' in n ? phrasingToText(n.children) : ''))
    .join('');
}

/**
 * 从 markdown 字符串提取 h1/h2/h3 标题列表。
 * index 是标题在文档中的出现顺序（从 0 开始），
 * 与 MarkdownBody 中 data-heading-id="heading-N" 的 N 对齐。
 */
export function extractHeadings(markdown: string): TocEntry[] {
  if (!markdown) return [];
  const tree = parser.parse(markdown);
  const entries: TocEntry[] = [];
  let idx = 0;

  function walk(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'heading' && node.depth <= 3) {
        entries.push({
          level: node.depth,
          text: phrasingToText((node as Heading).children),
          index: idx++,
        });
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children as RootContent[]);
      }
    }
  }

  walk(tree.children);
  return entries;
}
