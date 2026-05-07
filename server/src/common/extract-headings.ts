export interface HeadingDto {
  level: number; // 1-3
  text: string;
}

// 匹配 h1-h3 标题行：1-3 个 # 后跟空白和标题文本
const HEADING_REGEX = /^(#{1,3})\s+(.+)$/;

// 代码块起止标记（三个反引号开头）
const CODE_FENCE_REGEX = /^```/;

/**
 * 清理标题中的 TeX 公式标记，供目录展示：
 * - $$...$$ 块级公式整段移除（避免 TOC 被 LaTeX 占满）
 * - $...$ 行内公式去掉定界符保留内容（$k$ → k）
 * 去掉后仅余空白则整条标题不进入 headings。
 */
function stripDisplayMathForToc(raw: string): string {
  return raw
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从 markdown 文本中提取 h1-h3 级别的标题。
 * 跳过代码块内的标题（``` 包裹的区域），避免将代码注释误识别为标题。
 */
export function extractHeadings(markdown: string): HeadingDto[] {
  const headings: HeadingDto[] = [];
  let insideCodeBlock = false;

  for (const line of markdown.split('\n')) {
    // CRLF 下行首仍是 #，但行尾带 \r 会使 /^...$/ 匹配失败
    const lineNorm = line.replace(/\r$/, '');

    // 切换代码块状态
    if (CODE_FENCE_REGEX.test(lineNorm)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    // 代码块内跳过
    if (insideCodeBlock) continue;

    const match = HEADING_REGEX.exec(lineNorm);
    if (match) {
      const text = stripDisplayMathForToc(match[2].trim());
      if (!text) continue;
      headings.push({
        level: match[1].length,
        text,
      });
    }
  }

  return headings;
}
