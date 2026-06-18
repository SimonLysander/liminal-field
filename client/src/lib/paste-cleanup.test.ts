import { describe, expect, it } from 'vitest';
import { htmlToCleanMarkdown } from './paste-cleanup';

describe('htmlToCleanMarkdown', () => {
  it('剥去 inline style 仍保留段落', () => {
    const html = '<p style="color:red; font-family:Arial;">hello</p>';
    expect(htmlToCleanMarkdown(html).trim()).toBe('hello');
  });

  it('保留 H1-H3 结构', () => {
    const html = '<h1>title</h1><h2>sub</h2><h3>sub-sub</h3>';
    expect(htmlToCleanMarkdown(html)).toContain('# title');
    expect(htmlToCleanMarkdown(html)).toContain('## sub');
    expect(htmlToCleanMarkdown(html)).toContain('### sub-sub');
  });

  it('保留无序列表', () => {
    const html = '<ul><li>a</li><li>b</li></ul>';
    const md = htmlToCleanMarkdown(html);
    // turndown 输出 "-   a"（dash + 多个空格），regex 用 \s+ 兼容
    expect(md).toMatch(/[-*]\s+a/);
    expect(md).toMatch(/[-*]\s+b/);
  });

  it('保留链接', () => {
    const html = '<p>see <a href="https://x.com">x</a> for more</p>';
    expect(htmlToCleanMarkdown(html)).toContain('[x](https://x.com)');
  });

  it('保留代码块', () => {
    const html = '<pre><code>const a = 1;</code></pre>';
    expect(htmlToCleanMarkdown(html)).toContain('const a = 1;');
  });

  it('保留加粗 / 斜体', () => {
    const html = '<p><strong>bold</strong> and <em>italic</em></p>';
    expect(htmlToCleanMarkdown(html)).toMatch(/\*\*bold\*\*/);
    expect(htmlToCleanMarkdown(html)).toMatch(/[*_]italic[*_]/);
  });

  it('剥去 Word 风格 mso-* 属性', () => {
    const html = '<p style="mso-margin-top-alt:auto; color:#a31515;">word paste</p>';
    expect(htmlToCleanMarkdown(html).trim()).toBe('word paste');
  });

  it('剥去 class', () => {
    const html = '<p class="article-paragraph custom-color">content</p>';
    expect(htmlToCleanMarkdown(html).trim()).toBe('content');
  });

  it('HTML 超大（>50KB）时返回空字符串', () => {
    const big = '<p>' + 'x'.repeat(60_000) + '</p>';
    expect(htmlToCleanMarkdown(big)).toBe('');
  });
});
