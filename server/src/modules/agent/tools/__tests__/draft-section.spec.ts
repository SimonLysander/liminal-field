import { replaceDraftSection } from '../draft-section';

const DOCUMENT = [
  '# 光作为信息的载体',
  '',
  '开篇内容。',
  '',
  '## 反射率',
  '',
  '旧的反射率解释。',
  '',
  '### 失效条件',
  '',
  '旧的失效条件。',
  '',
  '## 透射率',
  '',
  '相邻章节。',
].join('\n');

describe('replaceDraftSection', () => {
  it('只替换目标标题下的内容，保留标题、子节之外的正文和相邻章节', () => {
    const result = replaceDraftSection(DOCUMENT, {
      sectionMarkdown: [
        '新的反射率解释。',
        '',
        '### 失效条件',
        '',
        '新的失效条件。',
      ].join('\n'),
      sectionPath: ['光作为信息的载体', '反射率'],
    });

    expect(result).toEqual({
      markdown: [
        '# 光作为信息的载体',
        '',
        '开篇内容。',
        '',
        '## 反射率',
        '',
        '新的反射率解释。',
        '',
        '### 失效条件',
        '',
        '新的失效条件。',
        '',
        '## 透射率',
        '',
        '相邻章节。',
      ].join('\n'),
      sectionLabel: '光作为信息的载体 > 反射率',
    });
  });

  it('忽略 fenced code 内伪造的标题，仍在真实同级标题前停止', () => {
    const document = [
      '## 目标',
      '',
      '```markdown',
      '## 不是标题',
      '```',
      '',
      '旧内容。',
      '',
      '## 下一个',
      '',
      '保留。',
    ].join('\n');

    expect(
      replaceDraftSection(document, {
        sectionMarkdown: '新内容。',
        sectionPath: ['目标'],
      }),
    ).toEqual({
      markdown: ['## 目标', '', '新内容。', '', '## 下一个', '', '保留。'].join(
        '\n',
      ),
      sectionLabel: '目标',
    });
  });

  it('重复的章节路径未指定 occurrence 时拒绝猜测', () => {
    const document = [
      '# A',
      '',
      '## 重复',
      '',
      '一',
      '',
      '## 重复',
      '',
      '二',
    ].join('\n');

    expect(() =>
      replaceDraftSection(document, {
        sectionMarkdown: '新内容。',
        sectionPath: ['A', '重复'],
      }),
    ).toThrow('匹配到 2 个章节');
  });

  it('拒绝在 H2 小节中插入同级或更高级标题', () => {
    expect(() =>
      replaceDraftSection(DOCUMENT, {
        sectionMarkdown: '## 越界标题\n\n内容。',
        sectionPath: ['光作为信息的载体', '反射率'],
      }),
    ).toThrow('只能包含比目标标题更低级的标题');
  });
});
