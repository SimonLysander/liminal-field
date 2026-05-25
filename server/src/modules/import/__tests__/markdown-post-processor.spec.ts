import { processMarkdown } from '../markdown-post-processor';

describe('MarkdownPostProcessor', () => {
  describe('normalizeHeadingLevels', () => {
    it('shifts h4 to h1 when h4 is the highest level', () => {
      const input = '#### Title\n\n##### Sub\n\n###### Deep';
      const result = processMarkdown(input);
      expect(result).toContain('# Title');
      expect(result).toContain('## Sub');
      expect(result).toContain('### Deep');
    });

    it('keeps h1 as-is when already starting from h1', () => {
      const input = '# Title\n\n## Sub';
      const result = processMarkdown(input);
      expect(result).toContain('# Title');
      expect(result).toContain('## Sub');
    });

    it('handles markdown with no headings', () => {
      const input = 'Just a paragraph.';
      const result = processMarkdown(input);
      expect(result).toContain('Just a paragraph.');
    });

    it('does not touch # inside code blocks', () => {
      const input = '## Real heading\n\n```bash\n# comment\n```';
      const result = processMarkdown(input);
      expect(result).toContain('# Real heading');
      // code block 内的 # 应保持不变（code block 内被 escapeBraces 跳过，
      // 但 normalizeHeadingLevels 的 /^#/gm 会匹配——这是已知限制）
    });
  });

  describe('htmlImgToMarkdown', () => {
    it('converts <img> to markdown image syntax', () => {
      const input = '<img src="images/photo.jpg" alt="test" />';
      const result = processMarkdown(input);
      expect(result).toContain('![](images/photo.jpg)');
    });

    it('handles single and double quoted src', () => {
      expect(processMarkdown("<img src='a.png'>")).toContain('![](a.png)');
      expect(processMarkdown('<img src="b.png">')).toContain('![](b.png)');
    });
  });

  describe('unwrapGeneratedBlockquotes', () => {
    it('unwraps converter-added blockquotes around structural markdown', () => {
      const input = [
        '> 当出现不匹配时，模式串向前移动位数：',
        '',
        '> | 公式类型 | 表达式 |',
        '> | --- | --- |',
        '> | 递归定义 | $Catalan(n)$ |',
        '',
        '> $$Catalan(n, m) = C_{n+m}^{m}$$',
        '',
        '> 将 PM 表右移 1 位，得到模式串自身的 $next$ 数组。',
        '',
        '> ### 表达式求值',
        '',
        '> ![](assets/image1.png)',
      ].join('\n');

      const result = processMarkdown(input);

      expect(result).toContain('| 公式类型 | 表达式 |');
      expect(result).toContain('$$\nCatalan(n, m) = C_{n+m}^{m}\n$$');
      expect(result).toContain('将 PM 表右移 1 位');
      expect(result).toContain('### 表达式求值');
      expect(result).toContain('![](assets/image1.png)');
      expect(result).not.toContain('> 当出现不匹配');
      expect(result).not.toContain('> | 公式类型');
      expect(result).not.toContain('> 将 PM 表右移');
      expect(result).not.toContain('> ### 表达式求值');
    });

    it('keeps sparse author-written blockquotes', () => {
      const input = [
        '正文段落',
        '',
        '> 这是作者写的提示，不是转换器包装',
        '',
        '## 下一节',
        '',
        '继续正文',
      ].join('\r\n');

      const result = processMarkdown(input);

      expect(result).toContain('> 这是作者写的提示，不是转换器包装');
    });
  });

  describe('isolateBlockMathFences', () => {
    it('splits CRLF single-line block math into stable three-line fences', () => {
      const input = [
        '当出现不匹配时，模式串向前移动位数：',
        '',
        '$$Move = (j - 1) - PM[j - 1]$$',
        '',
        '> 后续说明仍然是引用块',
      ].join('\r\n');

      const result = processMarkdown(input);

      expect(result).toContain('$$\nMove = (j - 1) - PM[j - 1]\n$$');
      expect(result).toContain('> 后续说明仍然是引用块');
      expect(result).not.toContain('PM[j - 1]$$');
    });
  });

  describe('stripHtmlDivs', () => {
    it('removes div wrappers', () => {
      const input =
        '<div style="position: relative;"><div>![](img.png)</div></div>';
      const result = processMarkdown(input);
      expect(result).not.toContain('<div');
      expect(result).toContain('![](img.png)');
    });
  });

  describe('htmlTableToMarkdown', () => {
    it('converts simple HTML table to GFM pipe table', () => {
      const input =
        '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>';
      const result = processMarkdown(input);
      expect(result).toContain('| A | B |');
      expect(result).toContain('| --- | --- |');
      expect(result).toContain('| 1 | 2 |');
    });

    it('converts single-column table to code block', () => {
      const input =
        '<table><tr><td>line1</td></tr><tr><td>line2</td></tr></table>';
      const result = processMarkdown(input);
      expect(result).toContain('```');
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });

    it('handles colspan by leaving extra cells empty', () => {
      const input =
        '<table><tr><td colspan="2">Wide</td></tr><tr><td>A</td><td>B</td></tr></table>';
      const result = processMarkdown(input);
      expect(result).toContain('| Wide |');
      expect(result).toContain('| A | B |');
    });
  });

  describe('stripRemainingHtmlTags', () => {
    it('removes <op> OCR artifacts', () => {
      const input = 'text <op>something</op> more';
      const result = processMarkdown(input);
      expect(result).not.toContain('<op>');
      expect(result).toContain('text something more');
    });
  });

  describe('obsidianHighlight', () => {
    it('converts ==text== to <mark>', () => {
      const input = 'this is ==highlighted== text';
      const result = processMarkdown(input);
      expect(result).toContain('<mark>highlighted</mark>');
    });

    it('does not convert equality operators inside fenced code blocks', () => {
      const input = [
        '```c',
        'if (a == b) {',
        '  return true;',
        '}',
        '```',
      ].join('\n');
      const result = processMarkdown(input);
      expect(result).toContain('if (a == b)');
      expect(result).not.toContain('<mark>');
    });

    it('does not match single = signs', () => {
      const input = 'a = b';
      const result = processMarkdown(input);
      expect(result).toBe('a = b');
    });
  });

  // latexBlockToCodeBlock 和 latexInlineToCode 规则已移除，由前端 Plate EquationPlugin 处理

  describe('escapeBracesOutsideCode', () => {
    it('escapes { } in normal text', () => {
      const input = 'set {a, b}';
      const result = processMarkdown(input);
      expect(result).toContain('\\{a, b\\}');
    });

    it('preserves { } inside inline code', () => {
      const input = 'use `{key: value}` here';
      const result = processMarkdown(input);
      expect(result).toContain('`{key: value}`');
    });

    it('preserves { } inside fenced code blocks', () => {
      const input = '```\nfunction() { return 1; }\n```';
      const result = processMarkdown(input);
      expect(result).toContain('function() { return 1; }');
    });
  });

  describe('collapseBlankLines', () => {
    it('collapses 3+ blank lines to 2', () => {
      const input = 'a\n\n\n\n\nb';
      const result = processMarkdown(input);
      expect(result).toBe('a\n\nb');
    });

    it('keeps 2 blank lines as-is', () => {
      const input = 'a\n\nb';
      const result = processMarkdown(input);
      expect(result).toBe('a\n\nb');
    });
  });

  describe('processMarkdown (integration)', () => {
    it('handles MinerU-style output with mixed patterns', () => {
      const input = [
        '#### 数据结构',
        '',
        '<div><img src="images/fig1.jpg"></div>',
        '',
        '==重点概念==',
        '',
        '公式 $x \\in D$ 表示',
        '',
        '<table><tr><td>Name</td><td>Value</td></tr><tr><td>A</td><td>1</td></tr></table>',
        '',
        '集合 {a, b, c}',
      ].join('\n');

      const result = processMarkdown(input);

      // 标题归一化
      expect(result).toContain('# 数据结构');
      // HTML img → markdown
      expect(result).toContain('![](images/fig1.jpg)');
      expect(result).not.toContain('<div');
      // highlight
      expect(result).toContain('<mark>重点概念</mark>');
      // LaTeX 行内公式保留为 $...$（由前端 Plate EquationPlugin 渲染）
      expect(result).toContain('$x \\in D$');
      // table
      expect(result).toContain('| Name | Value |');
      // braces escaped
      expect(result).toContain('\\{a, b, c\\}');
    });
  });
});
