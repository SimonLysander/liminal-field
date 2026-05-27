import { PromptHandler } from '../prompt.handler';

describe('PromptHandler <document> 节注入', () => {
  const handler = new PromptHandler();
  const base = {
    coreMemories: [],
    ownerProfile: { name: '主人', birthday: '', bio: '', interests: '' },
  };

  it('document 字段存在 → 注入 <document> 节(纯 markdown)', () => {
    const prompt = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'note-1',
        title: '今日笔记',
        bodyMarkdown: '# 标题\n\n第一段正文。\n\n第二段正文。',
      },
    });
    expect(prompt).toContain('<document>');
    expect(prompt).toContain('# 标题');
    expect(prompt).toContain('第一段正文。');
    expect(prompt).toContain('</document>');
  });

  it('document 字段缺失 → 不注入 <document> 节', () => {
    const prompt = handler.buildSystemPrompt(base);
    expect(prompt).not.toContain('<document>');
  });

  it('<document> 节内不带块 id / 段号标记(纯 markdown)', () => {
    const prompt = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'note-1',
        title: '笔记',
        bodyMarkdown: '段一。\n\n段二。',
      },
    });
    expect(prompt).not.toMatch(/<block\s+id=/);
    expect(prompt).not.toMatch(/data-block-id/);
  });

  it('工具纪律提到 propose_document_rewrite(单工具)', () => {
    const prompt = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'note-1',
        title: '笔记',
        bodyMarkdown: '正文。',
      },
    });
    expect(prompt).toContain('propose_document_rewrite');
  });
});
