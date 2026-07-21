import { describe, expect, it } from 'vitest';
import { buildCopyPageMarkdown } from '../copy-page';

describe('buildCopyPageMarkdown', () => {
  it('builds portable markdown with metadata and references', () => {
    expect(
      buildCopyPageMarkdown({
        bodyMarkdown: '# 标题\n\n正文',
        metadata: [{ key: 'updated', label: '更新于', value: '2026-07-03' }],
        references: [
          {
            index: 1,
            sourceName: 'Example',
            title: '来源',
            url: 'https://example.com',
          },
        ],
        summary: '摘要',
        source: 'note',
        title: '标题',
      }),
    ).toBe(
      [
        '---',
        'title: "标题"',
        'source: "note"',
        'updated: "2026-07-03"',
        'summary: "摘要"',
        '---',
        '',
        '# 标题',
        '',
        '正文',
        '',
        '## 引用',
        '- [1] [来源 — Example](https://example.com)',
      ].join('\n'),
    );
  });

  it('omits empty optional sections', () => {
    expect(
      buildCopyPageMarkdown({
        bodyMarkdown: '\n\n正文\n\n\n',
        metadata: [{ label: '空', value: '' }],
        title: '标题',
      }),
    ).toBe('---\ntitle: "标题"\n---\n\n正文');
  });

  it('uses block scalars for multiline front matter values', () => {
    expect(
      buildCopyPageMarkdown({
        bodyMarkdown: '正文',
        summary: '第一行\n第二行',
        title: '标题',
      }),
    ).toBe('---\ntitle: "标题"\nsummary: |-\n  第一行\n  第二行\n---\n\n正文');
  });

  it('escapes reference markdown syntax without touching display text semantics', () => {
    expect(
      buildCopyPageMarkdown({
        references: [
          {
            title: '标题]片段',
            url: 'https://example.com/a path?q=)',
          },
        ],
        title: '标题',
      }),
    ).toBe(
      [
        '---',
        'title: "标题"',
        '---',
        '',
        '## 引用',
        '- [1] [标题\\]片段](https://example.com/a%20path?q=%29)',
      ].join('\n'),
    );
  });
});
