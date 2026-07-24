export type MarkdownFence = {
  marker: '`' | '~';
  size: number;
};

export function readMarkdownFence(
  line: string,
): { fence: MarkdownFence; trailing: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  if (match[1][0] === '`' && match[2].includes('`')) return null;

  return {
    fence: {
      marker: match[1][0] as MarkdownFence['marker'],
      size: match[1].length,
    },
    trailing: match[2],
  };
}

function normalizeDisplayMathLine(line: string): string[] | null {
  const indent = /^ */.exec(line)?.[0] ?? '';
  if (indent.length > 3 || line[indent.length] === '\t') return null;

  const content = line.slice(indent.length).trim();
  if (
    !content.startsWith('$$') ||
    !content.endsWith('$$') ||
    content.length <= 4
  ) {
    return null;
  }

  const expression = content.slice(2, -2).trim();
  if (!expression || expression.includes('$$')) return null;

  return [`${indent}$$`, `${indent}${expression}`, `${indent}$$`];
}

function findClosingDelimiter(
  line: string,
  delimiter: string,
  from: number,
): number {
  let cursor = from;

  while (cursor < line.length) {
    const found = line.indexOf(delimiter, cursor);
    if (found === -1) return -1;

    let backslashes = 0;
    for (let index = found - 1; index >= 0 && line[index] === '\\'; index -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return found;
    cursor = found + delimiter.length;
  }

  return -1;
}

function escapeMdxBracesInProse(line: string): string {
  let cursor = 0;
  let output = '';

  while (cursor < line.length) {
    const character = line[cursor];

    if (character === '\\' && cursor + 1 < line.length) {
      output += line.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    if (character === '`') {
      let size = 1;
      while (line[cursor + size] === '`') size += 1;
      const delimiter = '`'.repeat(size);
      const closing = findClosingDelimiter(line, delimiter, cursor + size);
      if (closing !== -1) {
        output += line.slice(cursor, closing + size);
        cursor = closing + size;
        continue;
      }
    }

    if (character === '$') {
      const delimiter = line[cursor + 1] === '$' ? '$$' : '$';
      const closing = findClosingDelimiter(
        line,
        delimiter,
        cursor + delimiter.length,
      );
      if (closing !== -1) {
        output += line.slice(cursor, closing + delimiter.length);
        cursor = closing + delimiter.length;
        continue;
      }
    }

    if (character === '{' || character === '}') {
      output += `\\${character}`;
    } else {
      output += character;
    }
    cursor += 1;
  }

  return output;
}

/**
 * 旧草稿曾用单行 `$$x$$` 表示公式块，remark-math 会把它解析成行内公式。
 * 反序列化前仅规范化独占整行的旧写法，并跳过代码围栏。Plate 的富文本标签
 * 仍依赖 remarkMdx，因此同时保护普通正文里的字面花括号，不改代码与公式。
 */
export function preprocessMarkdownForPlate(markdown: string): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let openFence: MarkdownFence | null = null;
  let inDisplayMath = false;

  for (const line of lines) {
    const fence = readMarkdownFence(line);

    if (openFence) {
      output.push(line);
      if (
        fence &&
        fence.fence.marker === openFence.marker &&
        fence.fence.size >= openFence.size &&
        fence.trailing.trim() === ''
      ) {
        openFence = null;
      }
      continue;
    }

    if (fence) {
      openFence = fence.fence;
      output.push(line);
      continue;
    }

    const normalizedLines = normalizeDisplayMathLine(line) ?? [line];
    for (const normalizedLine of normalizedLines) {
      if (normalizedLine.trim() === '$$') {
        inDisplayMath = !inDisplayMath;
        output.push(normalizedLine);
      } else {
        output.push(
          inDisplayMath
            ? normalizedLine
            : escapeMdxBracesInProse(normalizedLine),
        );
      }
    }
  }

  return output.join(newline);
}
