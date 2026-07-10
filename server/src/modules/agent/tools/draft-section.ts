export interface ReplaceDraftSectionInput {
  sectionPath: string[];
  sectionOccurrence?: number;
  sectionMarkdown: string;
}

export interface ReplaceDraftSectionResult {
  markdown: string;
  sectionLabel: string;
}

type MarkdownHeading = {
  contentStart: number;
  level: number;
  path: string[];
  start: number;
  title: string;
};

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * 只识别写作规范允许的 ATX H1-H3，并跳过 fenced code 中的伪标题。
 * 章节替换要按位置切 Markdown，不能用全局字符串匹配误伤示例代码。
 */
function scanHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const hierarchy: Array<{ level: number; title: string }> = [];
  let fence: string | undefined;
  let offset = 0;

  for (const line of markdown.split('\n')) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length)
        fence = undefined;
      offset += line.length + 1;
      continue;
    }

    if (!fence) {
      const headingMatch = line.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        while (hierarchy.length > 0 && hierarchy.at(-1)!.level >= level) {
          hierarchy.pop();
        }
        hierarchy.push({ level, title });
        headings.push({
          contentStart: offset + line.length + 1,
          level,
          path: hierarchy.map((entry) => entry.title),
          start: offset,
          title,
        });
      }
    }

    offset += line.length + 1;
  }

  return headings;
}

function normalizePath(path: string[]): string[] {
  const normalized = path.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error('sectionPath 不能为空。');
  return normalized;
}

function samePath(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}

function validateSectionBody(markdown: string, targetLevel: number): void {
  for (const heading of scanHeadings(markdown)) {
    if (heading.level <= targetLevel) {
      throw new Error(
        `局部正文只能包含比目标标题更低级的标题（目标为 H${targetLevel}）。`,
      );
    }
  }
}

export function replaceDraftSection(
  markdown: string,
  input: ReplaceDraftSectionInput,
): ReplaceDraftSectionResult {
  const sectionPath = normalizePath(input.sectionPath);
  const candidates = scanHeadings(markdown).filter((heading) =>
    samePath(heading.path, sectionPath),
  );

  if (candidates.length === 0) {
    throw new Error(`未找到章节「${sectionPath.join(' > ')}」。`);
  }

  const occurrence = input.sectionOccurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error('sectionOccurrence 必须是从 1 开始的整数。');
  }
  if (candidates.length > 1 && input.sectionOccurrence === undefined) {
    throw new Error(
      `章节路径「${sectionPath.join(' > ')}」匹配到 ${candidates.length} 个章节，请传 sectionOccurrence。`,
    );
  }

  const target = candidates[occurrence - 1];
  if (!target) {
    throw new Error(
      `章节路径「${sectionPath.join(' > ')}」不存在第 ${occurrence} 个匹配。`,
    );
  }

  validateSectionBody(input.sectionMarkdown, target.level);
  const allHeadings = scanHeadings(markdown);
  const targetIndex = allHeadings.findIndex(
    (heading) => heading.start === target.start,
  );
  const nextBoundary = allHeadings
    .slice(targetIndex + 1)
    .find((heading) => heading.level <= target.level);
  const body = input.sectionMarkdown.trim();
  const suffix = markdown.slice(nextBoundary?.start ?? markdown.length);
  const replacement = body ? `\n${body}${suffix ? '\n\n' : '\n'}` : '';

  return {
    markdown: `${markdown.slice(0, target.contentStart)}${replacement}${suffix}`,
    sectionLabel: sectionPath.join(' > '),
  };
}
