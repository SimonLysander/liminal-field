/**
 * PromptHandler 单测 —— 锁定 Aurora 系统提示词的"组装契约"(见 AURORA-CONTEXT-SPEC.md)。
 *
 * 测的是结构与不变量,不是文案逐字:
 * - 三层顺序:本体(role→owner→conventions)→ 横切(skills/memories/summary)→ work_context → tasks
 * - work_context 统一吃掉场景(编辑文档/画廊/简报);正文/大数据不进 prompt,靠工具按需读
 * - entrySystemPrompt(agent 定义)进 work_context;全局 custom prompt 末尾追加
 * - 各横切分节按需注入;不泄露产品名/模型名
 */
import { PromptHandler, type BuildSystemPromptParams } from './prompt.handler';
import type { AgentMemory } from '../memory/agent-memory.entity';
import type { Skill } from '../../skill/skill.entity';
import type { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

const mem = (title: string, content: string): AgentMemory =>
  ({ title, content }) as unknown as AgentMemory;

const baseParams = (
  over: Partial<BuildSystemPromptParams> = {},
): BuildSystemPromptParams => ({
  coreMemories: [],
  ...over,
});

/** PromptManagerService mock:按 .md 文件名返回含关键字的最小内容,{{var}} 占位替换。 */
function makeMockPromptManager(): PromptManagerService {
  const templates: Record<string, string> = {
    'aurora/role.md':
      '<role>\n你是 Aurora。你是 {{owner_name}} 的另一个自我,是 {{owner_name}} 理想中的那个我;最懂 {{owner_name}} 的朋友。\n</role>',
    'aurora/conventions.md':
      '<conventions>\n- 用中文,除非 {{owner_name}} 明确要求其他语言。\n</conventions>',
    'aurora/partials/skills-prelude.md':
      '你有以下技能(方法论)可调用。识别到对应场景时,调 load_skill 工具传 name 获取完整方法论指引。\n',
    'aurora/partials/memories-prelude.md':
      '你对所有者的认知:画像是长期综合,最近观察是近期细节。远古具体细节调 recall_memory(topic) 或 search_memories(query)。\n',
    'aurora/partials/conversation-summary-prelude.md':
      '以下是本次会话的脉络记忆（更早的对话已被提炼进记忆，原文仍可用 read_conversation_history 精确回溯）：\n',
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
    listLoaded: () => Object.keys(templates),
  } as unknown as PromptManagerService;
}

describe('PromptHandler.buildSystemPrompt', () => {
  let handler: PromptHandler;
  beforeEach(() => {
    handler = new PromptHandler(makeMockPromptManager());
  });

  describe('一、本体 —— role / owner / conventions', () => {
    it('始终注入 role(点名 Aurora)与 conventions', () => {
      const out = handler.buildSystemPrompt(baseParams());
      expect(out).toContain('<role>');
      expect(out).toContain('Aurora');
      expect(out).toContain('<conventions>');
    });

    it('有 ownerProfile.name → 注入 owner 并用真名;role 里也用真名', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ ownerProfile: { name: '阿秋', birthday: '', bio: '' } }),
      );
      expect(out).toContain('<owner>');
      expect(out).toContain('你在陪伴 阿秋');
      expect(out).toContain('阿秋 的另一个自我');
    });

    it('无 ownerProfile → 不注入 owner,role 用占位"所有者"', () => {
      const out = handler.buildSystemPrompt(baseParams());
      expect(out).not.toContain('<owner>');
      expect(out).toContain('所有者');
    });

    it('owner 分节按字段拼生日/简介', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          ownerProfile: { name: '阿秋', birthday: '1999-01-01', bio: '写作者' },
        }),
      );
      expect(out).toContain('生日：1999-01-01');
      expect(out).toContain('简介：写作者');
    });
  });

  describe('三、work_context —— 编辑文档场景(正文不进 prompt)', () => {
    it('有 document → work_context 点名标题/字数,正文不出现,走 get_current_draft', () => {
      const body = '这是不应该出现在 prompt 里的正文内容';
      const out = handler.buildSystemPrompt(
        baseParams({
          document: {
            contentItemId: 'ci_1',
            title: '我的随笔',
            bodyMarkdown: body,
          },
        }),
      );
      expect(out).toContain('<work_context>');
      expect(out).toContain('《我的随笔》');
      expect(out).toContain(`约 ${body.length} 字`);
      expect(out).toContain('get_current_draft');
      expect(out).not.toContain('<document>');
      expect(out).not.toContain(body);
    });

    it('无场景且无 entrySystemPrompt → 不注入 work_context', () => {
      const out = handler.buildSystemPrompt(baseParams());
      expect(out).not.toContain('<work_context>');
    });

    it('document.collectionContext → work_context 内含 <collection>', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          document: {
            contentItemId: 'ci_x:e002',
            title: '第二篇',
            bodyMarkdown: 'x',
            collectionContext:
              '本条目属于文集《四季》,共 3 篇:\n1. 春\n2. 夏 ← 当前\n3. 秋',
          },
        }),
      );
      expect(out).toContain('<collection>');
      expect(out).toContain('文集《四季》');
      expect(out).toContain('2. 夏 ← 当前');
    });

    it('document 无 collectionContext → 不注入 <collection>', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          document: { contentItemId: 'ci_1', title: '随笔', bodyMarkdown: 'x' },
        }),
      );
      expect(out).not.toContain('<collection>');
    });

    it('document 无标题 → 用"未命名"占位', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          document: { contentItemId: 'ci_1', title: '', bodyMarkdown: 'x' },
        }),
      );
      expect(out).toContain('《未命名》');
    });
  });

  describe('tasks —— 仅未完成才注入', () => {
    it('有未完成任务 → 注入 tasks,含状态中文标签', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          tasks: [
            { title: '列大纲', status: 'done' },
            { title: '写引言', status: 'in_progress' },
          ],
        }),
      );
      expect(out).toContain('<tasks>');
      expect(out).toContain('[完成] 列大纲');
      expect(out).toContain('[进行中] 写引言');
    });

    it('全部完成 → 不注入 tasks', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          tasks: [
            { title: 'a', status: 'done' },
            { title: 'b', status: 'done' },
          ],
        }),
      );
      expect(out).not.toContain('<tasks>');
    });

    it('空任务列表 → 不注入 tasks', () => {
      const out = handler.buildSystemPrompt(baseParams({ tasks: [] }));
      expect(out).not.toContain('<tasks>');
    });

    it('任务缺 status → 视为 pending(待办)', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ tasks: [{ title: '无状态任务' }] }),
      );
      expect(out).toContain('[待办] 无状态任务');
    });
  });

  describe('二、横切 —— 记忆 / 会话脉络按需注入', () => {
    it('coreMemories → 注入标题索引(全文按需 recall)', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ coreMemories: [mem('身份', '我是写作者')] }),
      );
      expect(out).toContain('<memories_index>');
      expect(out).toContain('- 身份');
      expect(out).toContain('recall_memory');
      expect(out).not.toContain('我是写作者');
    });

    it('sessionMemory 有才注入', () => {
      const without = handler.buildSystemPrompt(baseParams());
      expect(without).not.toContain('<conversation_summary>');

      const out = handler.buildSystemPrompt(
        baseParams({ sessionMemory: '之前会话的脉络' }),
      );
      expect(out).toContain('<conversation_summary>');
      expect(out).toContain('之前会话的脉络');
    });
  });

  describe('entrySystemPrompt 进 work_context;全局 custom 末尾追加', () => {
    it('entrySystemPrompt → work_context 内;custom → 末尾,且在 entry 之后', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          entrySystemPrompt: '入口级提示',
          customSystemPrompt: '全局提示',
        }),
      );
      expect(out).toContain('<work_context>');
      expect(out).toContain('入口级提示');
      expect(out).toContain('全局提示');
      // entry 在 work_context 里
      expect(out.indexOf('入口级提示')).toBeGreaterThan(
        out.indexOf('<work_context>'),
      );
      // custom 最后
      expect(out.indexOf('全局提示')).toBeGreaterThan(
        out.indexOf('入口级提示'),
      );
    });

    it('空白 entry/custom 不注入;无场景时末尾是 conventions', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ entrySystemPrompt: '   ', customSystemPrompt: '' }),
      );
      expect(out).not.toContain('<work_context>');
      expect(out.trim().endsWith('</conventions>')).toBe(true);
    });
  });

  it('三层顺序:role→owner→conventions→memories_index→work_context→tasks', () => {
    const out = handler.buildSystemPrompt(
      baseParams({
        ownerProfile: { name: '阿秋', birthday: '', bio: '' },
        coreMemories: [mem('核心', '核心记忆')],
        document: { contentItemId: 'ci_1', title: 'T', bodyMarkdown: 'x' },
        tasks: [{ title: 't', status: 'pending' }],
      }),
    );
    const order = [
      '<role>',
      '<owner>',
      '<conventions>',
      '<memories_index>',
      '<work_context>',
      '<tasks>',
    ].map((tag) => out.indexOf(tag));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe('<available_skills> 注入(spec §5.1)', () => {
    const mkSkill = (over: Partial<Skill> = {}): Skill =>
      ({
        name: 'critic',
        displayName: '批评家',
        description: '挑稿子结构与逻辑问题',
        whenToUse: '用户说"批评"/"挑毛病"/"严点说"时',
        body: '严厉方法论 body 内容 — 这段绝不能进 system prompt',
        requiredTools: [],
        ...over,
      }) as unknown as Skill;

    it('enabledSkills 空/未传 → 不注入', () => {
      expect(
        handler.buildSystemPrompt(baseParams({ enabledSkills: [] })),
      ).not.toContain('<available_skills>');
      expect(handler.buildSystemPrompt(baseParams())).not.toContain(
        '<available_skills>',
      );
    });

    it('非空 → 注入 name/description/when_to_use,但 body 绝不进 system prompt', () => {
      const skill = mkSkill();
      const out = handler.buildSystemPrompt(
        baseParams({ enabledSkills: [skill] }),
      );
      expect(out).toContain('<available_skills>');
      expect(out).toContain('name: critic');
      expect(out).toContain('description: 挑稿子结构与逻辑问题');
      expect(out).toContain('when_to_use: 用户说"批评"/"挑毛病"/"严点说"时');
      expect(out).not.toContain(skill.body);
      expect(out).not.toContain('严厉方法论 body 内容');
    });

    it('多个 skill 按数组顺序列出', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          enabledSkills: [
            mkSkill({ name: 'critic' }),
            mkSkill({
              name: 'polisher',
              description: '润色字句',
              whenToUse: '求润色时',
            }),
          ],
        }),
      );
      expect(out.indexOf('name: critic')).toBeLessThan(
        out.indexOf('name: polisher'),
      );
    });
  });

  describe('简报阅读场景 —— 全篇注入进 work_context', () => {
    const sampleMarkdown =
      '## 训练新法\n\nZigZag-2 提出了三段式稀疏注意力 [CIT 1],在 32K 上下文上吞吐提升 2.1x。\n\n## 部署成本\n\nGPT-X 部署成本环比降 30% [CIT 2]。';
    const sampleReport = {
      reportId: 'rep_1',
      topicId: 'top_1',
      topicName: 'AI 周报',
      topicPrompt: '关注 LLM 训练前沿',
      headline: '本周 LLM 三件事',
      publishedAt: '2026-06-21',
      markdown: sampleMarkdown,
      sections: ['训练新法', '部署成本', '行业并购'],
      findings: [
        {
          citationId: 1,
          title: 'ZigZag-2 训练范式',
          sourceName: 'arXiv',
          url: 'https://arxiv.org/abs/2026.0001',
          reason: '提出三段式稀疏注意力,2倍吞吐',
          snippet: '我们引入三段式注意力,在 32K 上下文下吞吐提升至 2.1x...',
        },
        {
          citationId: 2,
          title: 'GPT-X 部署成本下降',
          sourceName: 'TechCrunch',
          url: 'https://example.com/2',
        },
      ],
    };

    it('有 digestReport → work_context 含 topic/期号/章节/markdown全文/findings 完整', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ digestReport: sampleReport }),
      );
      expect(out).toContain('<work_context>');
      expect(out).toContain('AI 周报');
      expect(out).toContain('2026-06-21');
      expect(out).toContain('本周 LLM 三件事');
      expect(out).toContain('关注 LLM 训练前沿');
      expect(out).toContain('训练新法');
      expect(out).toContain('报告正文(markdown');
      expect(out).toContain('ZigZag-2 提出了三段式稀疏注意力');
      expect(out).toContain('GPT-X 部署成本环比降 30%');
      expect(out).toContain('[CIT 1]');
      expect(out).toContain('ZigZag-2 训练范式');
      expect(out).toContain('事实摘要:提出三段式');
      expect(out).toContain('原文片段:我们引入');
      expect(out).toContain('[CIT 2]');
    });

    it('markdown 为空 → 不注入"报告正文"段(其他字段照常)', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ digestReport: { ...sampleReport, markdown: '   ' } }),
      );
      expect(out).toContain('<work_context>');
      expect(out).not.toContain('报告正文(markdown');
      expect(out).toContain('[CIT 1]');
    });

    it('findings 缺 reason/snippet → 不报错,只省略对应行', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ digestReport: sampleReport }),
      );
      const cit2Idx = out.lastIndexOf('[CIT 2]');
      const blockEnd = out.indexOf('</work_context>', cit2Idx);
      const cit2Block = out.slice(cit2Idx, blockEnd);
      expect(cit2Block).not.toContain('事实摘要');
      expect(cit2Block).not.toContain('原文片段');
      expect(cit2Block).toContain('https://example.com/2');
    });

    it('无 digestReport → 不注入相关内容', () => {
      const out = handler.buildSystemPrompt(baseParams());
      expect(out).not.toContain('报告正文(markdown');
    });
  });

  it('不泄露产品名或模型名', () => {
    const out = handler.buildSystemPrompt(
      baseParams({
        ownerProfile: { name: '阿秋', birthday: '', bio: '' },
        document: { contentItemId: 'ci_1', title: 'T', bodyMarkdown: 'x' },
      }),
    );
    expect(out).not.toContain('Liminal Field');
    expect(out).not.toContain('liminal');
    expect(out.toLowerCase()).not.toContain('deepseek');
  });
});
