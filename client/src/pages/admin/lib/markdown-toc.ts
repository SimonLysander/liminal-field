/**
 * markdown-toc — 从 markdown 提取标题层级,供笔记/文集编辑器大纲共用。
 *
 * 模块级纯函数:避免 useMemo 内对闭包变量重新赋值触发 react-hooks 纯度规则。
 * 原先两个编辑器各自重复一份,抽到此处去重。
 */

export type HeadingEntry = { level: number; text: string; index: number };

/** 清理标题中的 LaTeX 定界符:$$...$$ 移除,$...$ 保留内容 */
export function stripLatexForToc(raw: string): string {
  return raw
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从正文 markdown 提取 h1–h3 标题(跳过代码块) */
export function extractHeadingEntriesFromMarkdown(bodyMarkdown: string): HeadingEntry[] {
  const acc: HeadingEntry[] = [];
  let idx = 0;
  let inCodeBlock = false;
  for (const line of bodyMarkdown.split('\n')) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const text = stripLatexForToc(match[2].trim());
      if (!text) continue;
      acc.push({ level: match[1].length, text, index: idx });
      idx += 1;
    }
  }
  return acc;
}
