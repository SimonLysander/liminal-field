export type HeadingNumberingMode = 'none' | 'note' | 'anthology';
export type HeadingNumberingInput = HeadingNumberingMode | null | undefined;

export function getHeadingNumberingClass(
  input: HeadingNumberingInput,
): string {
  if (input === 'note') return 'heading-numbering-note';
  if (input === 'anthology') return 'heading-numbering-anthology';
  return '';
}

/**
 * 笔记的 Markdown 标题是扁平兄弟节点，不能靠 CSS counter 在 H1 后重置 H2。
 * 在渲染后的标题顺序上计算展示编号，保证阅读器与编辑器使用同一套层级规则。
 */
export function getNoteHeadingNumbers(levels: readonly number[]): string[] {
  let h1Count = 0;
  let h2Count = 0;

  return levels.map((level) => {
    if (level === 1) {
      h1Count += 1;
      h2Count = 0;
      return `${toCjkNumeral(h1Count)}、`;
    }

    if (level === 2) {
      if (h1Count === 0) return '';
      h2Count += 1;
      return `${h1Count}.${h2Count}`;
    }

    return '';
  });
}

/** 仅加渲染属性；不修改 Slate 节点或 Markdown。 */
export function applyHeadingNumbering(
  container: ParentNode,
  input: HeadingNumberingInput,
): void {
  const headings = Array.from(container.querySelectorAll<HTMLElement>('h1, h2'));

  for (const heading of headings) {
    heading.removeAttribute('data-heading-number');
  }

  if (input !== 'note') return;

  const labels = getNoteHeadingNumbers(
    headings.map((heading) => Number(heading.tagName.slice(1))),
  );

  headings.forEach((heading, index) => {
    const label = labels[index];
    if (label) heading.dataset.headingNumber = label;
  });
}

function toCjkNumeral(value: number): string {
  const numerals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return numerals[value];
  if (value === 10) return '十';
  if (value < 20) return `十${numerals[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${numerals[tens]}十${ones === 0 ? '' : numerals[ones]}`;
}
