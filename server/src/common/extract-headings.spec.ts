import { extractHeadings } from './extract-headings';

describe('extractHeadings', () => {
  // 基本标题提取：h1、h2、h3 都应正确识别
  it('提取 h1、h2、h3 标题', () => {
    const md = `# 一级标题\n## 二级标题\n### 三级标题`;
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '一级标题' },
      { level: 2, text: '二级标题' },
      { level: 3, text: '三级标题' },
    ]);
  });

  // h4-h6 超出范围，应被忽略
  it('忽略 h4-h6 标题', () => {
    const md = `#### 四级\n##### 五级\n###### 六级`;
    expect(extractHeadings(md)).toEqual([]);
  });

  // 代码块内的 # 行不是标题，应跳过
  it('跳过代码块内的标题', () => {
    const md = [
      '# 真正的标题',
      '```',
      '# 代码块里的假标题',
      '## 同样跳过',
      '```',
      '## 代码块后的真标题',
    ].join('\n');
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '真正的标题' },
      { level: 2, text: '代码块后的真标题' },
    ]);
  });

  // 空字符串无标题
  it('空字符串返回空数组', () => {
    expect(extractHeadings('')).toEqual([]);
  });

  // 没有标题行的正文
  it('没有标题的 markdown 返回空数组', () => {
    const md = `这是正文\n\n这也是正文\n- 列表项`;
    expect(extractHeadings(md)).toEqual([]);
  });

  // 标题文本中含 inline code（反引号）时，文本应原样保留
  it('标题文本含 inline code 时正确提取', () => {
    const md = '## 使用 `useState` 钩子';
    expect(extractHeadings(md)).toEqual([
      { level: 2, text: '使用 `useState` 钩子' },
    ]);
  });

  // 多个连续标题之间无空行
  it('多个连续标题', () => {
    const md = `# A\n## B\n## C\n### D`;
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'B' },
      { level: 2, text: 'C' },
      { level: 3, text: 'D' },
    ]);
  });

  // 标题前后有空行，不影响提取结果
  it('标题前后有空行时正确提取', () => {
    const md = `\n\n# 带空行的标题\n\n正文\n\n## 另一个标题\n\n`;
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '带空行的标题' },
      { level: 2, text: '另一个标题' },
    ]);
  });

  // 目录文案去掉同一行内的 $$...$$，避免公式挤占 TOC
  it('标题中的 $$ 块级公式从 TOC 文案中移除', () => {
    const md = '## 前文 $$E=mc^2$$ 后文\n# $$\\sin x + \\cos x$$\n# 正常标题\n';
    expect(extractHeadings(md)).toEqual([
      { level: 2, text: '前文 后文' },
      { level: 1, text: '正常标题' },
    ]);
  });

  // CRLF 换行时仍能识别标题（与 LF 行为一致）
  it('CRLF 换行下仍能提取标题', () => {
    const md = '# 标题一\r\n\r\n## 标题二\r\n';
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '标题一' },
      { level: 2, text: '标题二' },
    ]);
  });
});
