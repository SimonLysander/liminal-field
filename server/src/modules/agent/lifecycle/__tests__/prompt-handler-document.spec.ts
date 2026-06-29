/**
 * PromptHandler 编辑文档场景 —— 正文不进 prompt(Read-before-Edit)+ 大纲 + work_context 收口。
 * "不能改正文"等写作专属约束已迁入 writing-advisor agent 提示词,不再由 buildSystemPrompt 全局注入。
 */
import { PromptHandler } from '../prompt.handler';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';

function makeMockPromptManager(): PromptManagerService {
  const templates: Record<string, string> = {
    'aurora/role.md':
      '<role>\n你是 Aurora。你是 {{owner_name}} 的另一个自我。\n</role>',
    'aurora/conventions.md': '<conventions>\n- 用中文。\n</conventions>',
    'aurora/partials/skills-prelude.md': '调 load_skill。\n',
    'aurora/partials/memories-prelude.md': '远古细节调 recall_memory。\n',
    'aurora/partials/conversation-summary-prelude.md': '本次会话脉络:\n',
  };
  return {
    render(name: string, vars: Record<string, string> = {}): string {
      const tmpl = templates[name];
      if (!tmpl) throw new Error(`mock: prompt not found: ${name}`);
      return tmpl.replace(
        /\{\{(\w+)\}\}/g,
        (_m, k: string) => vars[k] ?? `{{${k}}}`,
      );
    },
  } as unknown as PromptManagerService;
}

describe('PromptHandler 编辑文档场景', () => {
  const handler = new PromptHandler(makeMockPromptManager());
  const base = {
    coreMemories: [],
    ownerProfile: { name: '主人', birthday: '', bio: '' },
  };

  it('不注入 <document> 节,整篇正文不进 prompt', () => {
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

  it('document 缺失(且无 agent)→ 不注入 work_context', () => {
    const out = handler.buildSystemPrompt(base);
    expect(out).not.toContain('<work_context>');
  });

  it('有标题 → work_context 内含 <outline>(用 extractHeadings)', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '# 大标题\n\n## 子标题\n\n正文段。',
      },
    });
    expect(out).toContain('<work_context>');
    expect(out).toContain('<outline>');
    expect(out).toContain('大标题');
    expect(out).toContain('子标题');
  });

  it('无标题 → 不注入 <outline>', () => {
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

  it('work_context 点名编辑但不含正文,引导 get_current_draft', () => {
    const out = handler.buildSystemPrompt({
      ...base,
      document: {
        contentItemId: 'ci_x',
        title: 'T',
        bodyMarkdown: '这是机密正文,不应进 prompt。',
      },
    });
    expect(out).toContain('<work_context>');
    expect(out).toContain('get_current_draft');
    expect(out).not.toContain('这是机密正文');
    // 改稿停用:bodyHash / propose_document_rewrite 已随之移除
    expect(out).not.toContain('bodyHash');
    expect(out).not.toContain('propose_document_rewrite');
  });
});
