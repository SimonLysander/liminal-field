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
 * 正文可能从 H1 开始，也可能因文档标题在编辑器外而从 H2 开始。
 * 以正文实际最高层级为章、下一层为节，保证两种结构使用同一套展示规则。
 */
export function getNoteHeadingNumbers(levels: readonly number[]): string[] {
  const topLevel = levels.includes(1) ? 1 : levels.includes(2) ? 2 : null;
  if (topLevel === null) return levels.map(() => '');

  let chapterCount = 0;
  let sectionCount = 0;
  return levels.map((level) => {
    if (level === topLevel) {
      chapterCount += 1;
      sectionCount = 0;
      return `${toCjkNumeral(chapterCount)}、`;
    }

    if (level === topLevel + 1) {
      if (chapterCount === 0) return '';
      sectionCount += 1;
      return `${chapterCount}.${sectionCount}`;
    }

    return '';
  });
}

/** 仅加渲染属性；不修改 Slate 节点或 Markdown。 */
export function applyHeadingNumbering(
  container: ParentNode,
  input: HeadingNumberingInput,
): void {
  const headings = Array.from(
    container.querySelectorAll<HTMLElement>('h1, h2, h3'),
  );

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
