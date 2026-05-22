/**
 * markdown.utils.ts — 工具层共用的 Markdown 解析工具。
 *
 * extractHeadings 在 get-current-document.tool 和 read-content.tool 中
 * 有完全相同的实现，统一到此处避免重复。
 */

/** 从 markdown 正文中提取 h1-h3 标题，跳过代码块内的伪标题 */
export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let inCodeBlock = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}
