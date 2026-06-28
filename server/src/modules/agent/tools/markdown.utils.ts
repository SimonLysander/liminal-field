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

/**
 * 把 markdown 切成「目录项 + 该节开头片段」,给审批卡的改动预览用。
 * 每个标题为一项,snippet 取标题后到下一标题之间正文的前 snippetLen 字(超出 …截断)。
 * 跳过代码块内的伪标题。
 */
export function extractSections(
  markdown: string,
  snippetLen = 40,
): Array<{ label: string; snippet?: string }> {
  const out: Array<{ label: string; snippet?: string }> = [];
  let cur: { label: string; body: string[] } | null = null;
  let inCodeBlock = false;
  const flush = () => {
    if (!cur) return;
    const text = cur.body.join(' ').replace(/\s+/g, ' ').trim();
    out.push({
      label: cur.label,
      snippet:
        text.length > snippetLen
          ? text.slice(0, snippetLen) + '…'
          : text || undefined,
    });
    cur = null;
  };
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      if (cur) cur.body.push(line.trim());
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.+)$/);
    if (h) {
      flush();
      cur = { label: h[1].trim(), body: [] };
    } else if (cur && line.trim()) {
      cur.body.push(line.trim());
    }
  }
  flush();
  return out;
}
