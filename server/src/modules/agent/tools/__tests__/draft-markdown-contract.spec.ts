import { validateDraftMarkdownContract } from '../draft-markdown-contract';

describe('validateDraftMarkdownContract', () => {
  it('接受项目支持的正文结构', () => {
    const markdown = [
      '# 主章',
      '',
      '正文含[链接](https://example.com)、行内公式 $x^2$ 和 `[^1]` 代码。',
      '',
      '## 小节',
      '',
      '- 列表项',
      '',
      '$$',
      'x + y = z',
      '$$',
      '',
      '```md',
      '<custom>[^2]</custom>',
      '```',
    ].join('\n');

    expect(validateDraftMarkdownContract(markdown)).toBeNull();
  });

  it.each([
    ['脚注', '正文[^1]。', '[@#CIT N]'],
    ['原始 HTML', '正文 <aside>补充</aside>', 'HTML'],
    ['引用式链接', '参见[来源][ref]。\n\n[ref]: https://a.dev', '引用式链接'],
    ['Wiki 链接', '参见[[内部页面]]。', 'Wiki'],
    ['H4', '#### 过深标题', 'H1-H3'],
    ['单行公式块', '$$x+y$$', '独占一行'],
    ['未闭合公式块', '$$\nx+y', '没有闭合'],
    ['未闭合代码块', '```ts\nconst x = 1;', '没有闭合'],
  ])('拒绝%s并返回可操作错误', (_label, markdown, expected) => {
    const error = validateDraftMarkdownContract(markdown);
    expect(error).toContain('第 1 行');
    expect(error).toContain(expected);
  });
});
