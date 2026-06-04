import { PromptHandler } from '../prompt.handler';

describe('PromptHandler <document> 注入硬化(v3)', () => {
  const handler = new PromptHandler();
  const base = {
    coreMemories: [],
    ownerProfile: { name: '主人', birthday: '', bio: '' },
  };

  it('不再注入 <document> 节(整篇正文不进 prompt)', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '# H1\n\n这是测试正文,确保不应该出现在 prompt 里。',
      },
    });
    expect(out).not.toContain('<document>');
    expect(out).not.toContain('这是测试正文');
  });

  it('document 缺失时 prompt 不含 <document> 节', () => {
    const out = handler.buildSystemPrompt(base);
    expect(out).not.toContain('<document>');
  });

  it('有标题时注入 <outline> 节(用 extractHeadings)', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '# 大标题\n\n## 子标题\n\n正文段。',
      },
    });
    expect(out).toContain('<outline>');
    expect(out).toContain('大标题');
    expect(out).toContain('子标题');
  });

  it('无标题时不注入 <outline> 节', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '只有正文,没有标题。',
      },
    });
    expect(out).not.toContain('<outline>');
  });

  it('<current_context> 不含正文', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '这是机密正文,不应进 prompt。',
      },
    });
    expect(out).toContain('<current_context>');
    expect(out).not.toContain('这是机密正文');
  });

  it('<tools> 仍引导调 get_current_draft 读正文', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '正文。',
      },
    });
    expect(out).toContain('get_current_draft');
    // 改稿停用(2026-06-04):bodyHash 仅为 propose_document_rewrite 强校验服务,已随改稿一并移除
    expect(out).not.toContain('bodyHash');
  });

  it('改稿停用:prompt 不再提 propose_document_rewrite,改为"没有改写正文能力"', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'note-1',
        title: '笔记',
        bodyMarkdown: '正文。',
      },
    });
    // 2026-06-04 改稿能力整体停用:工具不装配,prompt 也不应再指示模型调它
    expect(out).not.toContain('propose_document_rewrite');
    expect(out).toContain('没有直接改写文稿正文的能力');
  });
});
