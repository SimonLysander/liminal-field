export interface HeadingDto {
  level: number; // 1-3
  text: string;
}

// 匹配 h1-h3 标题行：1-3 个 # 后跟空白和标题文本
const HEADING_REGEX = /^(#{1,3})\s+(.+)$/;

// 代码块起止标记（三个反引号开头）
const CODE_FENCE_REGEX = /^```/;

/**
 * 从 markdown 文本中提取 h1-h3 级别的标题。
 * 跳过代码块内的标题（``` 包裹的区域），避免将代码注释误识别为标题。
 */
export function extractHeadings(markdown: string): HeadingDto[] {
  const headings: HeadingDto[] = [];
  let insideCodeBlock = false;

  for (const line of markdown.split('\n')) {
    // 切换代码块状态
    if (CODE_FENCE_REGEX.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    // 代码块内跳过
    if (insideCodeBlock) continue;

    const match = HEADING_REGEX.exec(line);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      });
    }
  }

  return headings;
}
