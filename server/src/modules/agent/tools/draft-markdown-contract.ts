function markdownContractError(line: number, detail: string): string {
  return `Markdown 格式不受支持（第 ${line} 行）：${detail}。只使用 H1-H3、段落、标准链接/图片、列表、引用块、表格、代码块、分隔线，以及 $…$ / 独占行的 $$ 公式。修正后重新调用。`;
}

function maskInlineCodeAndMath(line: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < line.length) {
    const delimiter = line[cursor];
    if (delimiter !== '`' && delimiter !== '$') {
      output += delimiter;
      cursor += 1;
      continue;
    }

    let size = 1;
    while (line[cursor + size] === delimiter) size += 1;
    if (delimiter === '$' && size > 1) {
      output += delimiter.repeat(size);
      cursor += size;
      continue;
    }

    const token = delimiter.repeat(size);
    const closing = line.indexOf(token, cursor + size);
    if (closing === -1) {
      output += token;
      cursor += size;
      continue;
    }
    output += ' '.repeat(closing + size - cursor);
    cursor = closing + size;
  }

  return output;
}

/**
 * write_draft 只接受编辑器能够稳定往返的 Markdown 子集。该门禁负责结构语法，
 * 内容事实与行文质量仍由 citationAudit 和审查 skill 负责。
 */
export function validateDraftMarkdownContract(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let codeFence: { marker: string; size: number; line: number } | null = null;
  let displayMathLine: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (codeFence) {
      if (
        fence &&
        fence[1][0] === codeFence.marker &&
        fence[1].length >= codeFence.size &&
        fence[2].trim() === ''
      ) {
        codeFence = null;
      }
      continue;
    }
    if (fence) {
      codeFence = {
        marker: fence[1][0],
        size: fence[1].length,
        line: lineNumber,
      };
      continue;
    }

    const trimmed = line.trim();
    if (displayMathLine !== null) {
      if (trimmed === '$$') displayMathLine = null;
      continue;
    }
    if (trimmed === '$$') {
      displayMathLine = lineNumber;
      continue;
    }
    if (line.includes('$$')) {
      return markdownContractError(
        lineNumber,
        '公式块的起止 $$ 必须分别独占一行，不能写成单行或与正文混排',
      );
    }

    const syntax = maskInlineCodeAndMath(line);
    if (/^ {0,3}#{4,6}\s/.test(syntax)) {
      return markdownContractError(lineNumber, '标题只允许 H1-H3');
    }
    const footnote = syntax.match(/\[\^[^\]\n]+\](?::)?/)?.[0];
    if (footnote) {
      return markdownContractError(
        lineNumber,
        `不使用脚注格式 ${footnote}；来源引用写成 [@#CIT N]`,
      );
    }
    if (
      /<!--|<\/?[A-Za-z][^>\n]*>/.test(syntax) ||
      /^\s*(?:import|export)\s+.+\s+from\s+['"]/.test(syntax)
    ) {
      return markdownContractError(lineNumber, '不允许原始 HTML、JSX 或 MDX');
    }
    if (
      /!?\[[^\]\n]+\]\[[^\]\n]*\]/.test(syntax) ||
      /^ {0,3}\[[^\]\n]+\]:\s*\S/.test(syntax)
    ) {
      return markdownContractError(
        lineNumber,
        '不使用引用式链接；链接与图片必须使用内联 (URL) 写法',
      );
    }
    if (/\[\[[^\]\n]+\]\]/.test(syntax) || /^ {0,3}:::\s*/.test(syntax)) {
      return markdownContractError(
        lineNumber,
        '不允许 Wiki 链接或 Markdown 指令块',
      );
    }
    if (/^ {0,3}=+\s*$/.test(syntax)) {
      return markdownContractError(lineNumber, '标题必须使用 #、## 或 ###');
    }
  }

  if (codeFence) {
    return markdownContractError(codeFence.line, '代码围栏没有闭合');
  }
  if (displayMathLine !== null) {
    return markdownContractError(displayMathLine, '公式块没有闭合');
  }
  return null;
}
