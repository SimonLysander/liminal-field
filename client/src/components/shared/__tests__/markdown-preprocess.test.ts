import { describe, expect, it } from 'vitest';

import { preprocessMarkdownForPlate } from '../markdown-preprocess';

describe('preprocessMarkdownForPlate', () => {
  it('规范化代码围栏外的旧式单行公式块', () => {
    const markdown = [
      '$$x + y$$',
      '',
      '```md',
      '$$insideBackticks$$',
      '```',
      '',
      '~~~md',
      '$$insideTildes$$',
      '~~~',
    ].join('\n');

    expect(preprocessMarkdownForPlate(markdown)).toBe(
      [
        '$$',
        'x + y',
        '$$',
        '',
        '```md',
        '$$insideBackticks$$',
        '```',
        '',
        '~~~md',
        '$$insideTildes$$',
        '~~~',
      ].join('\n'),
    );
  });

  it('保护普通正文花括号，但不改变代码和数学表达式', () => {
    const markdown = [
      '集合 {a, b}，`const x = { value: 1 }`，公式 $f(x)=\\frac{1}{x}$。',
      '',
      '$$',
      '\\sum_{i=1}^{n} i',
      '$$',
    ].join('\n');

    expect(preprocessMarkdownForPlate(markdown)).toBe(
      [
        '集合 \\{a, b\\}，`const x = { value: 1 }`，公式 $f(x)=\\frac{1}{x}$。',
        '',
        '$$',
        '\\sum_{i=1}^{n} i',
        '$$',
      ].join('\n'),
    );
  });
});
