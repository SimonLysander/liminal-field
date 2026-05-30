/**
 * PromptHandler 单测 —— 锁定 Aurora 系统提示词的"组装契约"。
 *
 * 这里测的是结构与不变量,不是文案逐字(文案会演进):
 * - 分节顺序(由近及远:owner→role→tools→记忆→instructions→current_context→tasks)
 * - current_context 只点名标题/字数,绝不把正文灌进 prompt(靠 get_current_draft 工具按需读)
 * - tasks 仅在有未完成任务时注入
 * - 各记忆/自定义分节按需注入
 * - 不泄露产品名("Liminal Field")或模型名
 */
import { PromptHandler, type BuildSystemPromptParams } from './prompt.handler';
import type { AgentMemory } from '../memory/agent-memory.entity';

// 构造最小记忆对象:buildSystemPrompt 只读 title/content,其余字段无关,故安全 cast。
const mem = (title: string, content: string): AgentMemory =>
  ({ title, content }) as unknown as AgentMemory;

// 必填字段(coreMemories 非可选)给空数组,其余按用例覆盖。
const baseParams = (
  over: Partial<BuildSystemPromptParams> = {},
): BuildSystemPromptParams => ({
  coreMemories: [],
  ...over,
});

describe('PromptHandler.buildSystemPrompt', () => {
  let handler: PromptHandler;
  beforeEach(() => {
    handler = new PromptHandler();
  });

  it('始终注入 role 分节,且 role 里点名 Aurora', () => {
    const out = handler.buildSystemPrompt(baseParams());
    expect(out).toContain('<role>');
    expect(out).toContain('Aurora');
    // tools 也是固定注入的
    expect(out).toContain('<tools>');
  });

  it('有 ownerProfile.name → 注入 owner 分节并用真名;role 里也用真名', () => {
    const out = handler.buildSystemPrompt(
      baseParams({
        ownerProfile: { name: '阿秋', birthday: '', bio: '' },
      }),
    );
    expect(out).toContain('<owner>');
    expect(out).toContain('你在陪伴 阿秋');
    expect(out).toContain('阿秋 的另一个自我');
  });

  it('无 ownerProfile → 不注入 owner 分节,role 用占位"所有者"', () => {
    const out = handler.buildSystemPrompt(baseParams());
    expect(out).not.toContain('<owner>');
    expect(out).toContain('所有者');
  });

  it('owner 分节只在对应字段存在时拼接生日/简介/在意的', () => {
    const out = handler.buildSystemPrompt(
      baseParams({
        ownerProfile: {
          name: '阿秋',
          birthday: '1999-01-01',
          bio: '写作者',
        },
      }),
    );
    expect(out).toContain('生日：1999-01-01');
    expect(out).toContain('简介：写作者');
  });

  describe('current_context —— 点名编辑文档;正文不进 prompt(v3.1 Read-before-Edit)', () => {
    it('有 document → 点名标题与字数,但正文不出现在 prompt(走 get_current_draft 按需读)', () => {
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
      expect(out).toContain('<current_context>');
      expect(out).toContain('《我的随笔》');
      expect(out).toContain(`约 ${body.length} 字`);
      expect(out).toContain('get_current_draft');
      // v3.1 关键契约:不再注入 <document> 节,正文不进 prompt;
      // 模型要看正文必须走 get_current_draft(同时拿到 bodyHash 走 Read-before-Edit)。
      expect(out).not.toContain('<document>');
      expect(out).not.toContain(body);
    });

    it('无 document → 不注入 current_context', () => {
      const out = handler.buildSystemPrompt(baseParams());
      expect(out).not.toContain('<current_context>');
    });

    it('document.collectionContext 有 → 注入 <collection> 块(文集场景的整集脉络)', () => {
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

    it('document 无 collectionContext(笔记场景) → 不注入 <collection>', () => {
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

    it('全部完成 → 不注入 tasks(避免每轮灌回"全 done"清单)', () => {
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

    it('任务缺 status → 视为 pending(待办)注入', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ tasks: [{ title: '无状态任务' }] }),
      );
      expect(out).toContain('[待办] 无状态任务');
    });
  });

  describe('记忆分节按需注入', () => {
    it('coreMemories 改注入标题索引(#150 2026-05-31:全文按需 recall)', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ coreMemories: [mem('身份', '我是写作者')] }),
      );
      expect(out).toContain('<memories_index>');
      expect(out).toContain('- 身份');
      expect(out).toContain('recall_memory');
      // 全文不再注入,需调工具
      expect(out).not.toContain('我是写作者');
    });

    it('sessionMemory 有才注入(relatedMemories 已删,#150 走 recall_memory)', () => {
      const without = handler.buildSystemPrompt(baseParams());
      expect(without).not.toContain('<conversation_summary>');

      const out = handler.buildSystemPrompt(
        baseParams({
          // session 记忆 content(脉络),替代旧 sessionSummary
          sessionMemory: '之前会话的脉络',
        }),
      );
      expect(out).toContain('<conversation_summary>');
      expect(out).toContain('之前会话的脉络');
    });
  });

  describe('自定义 system prompt 追加在末尾', () => {
    it('entrySystemPrompt + customSystemPrompt 都注入,且在 instructions 之后', () => {
      const out = handler.buildSystemPrompt(
        baseParams({
          entrySystemPrompt: '入口级提示',
          customSystemPrompt: '全局提示',
        }),
      );
      expect(out).toContain('入口级提示');
      expect(out).toContain('全局提示');
      expect(out.indexOf('入口级提示')).toBeGreaterThan(
        out.indexOf('<instructions>'),
      );
    });

    it('空白自定义 prompt 不注入', () => {
      const out = handler.buildSystemPrompt(
        baseParams({ entrySystemPrompt: '   ', customSystemPrompt: '' }),
      );
      // 末尾应是 instructions(无 document/tasks 时),不应有空字符串段落
      expect(out.trim().endsWith('</instructions>')).toBe(true);
    });
  });

  it('分节顺序:owner→role→tools→memories_index→instructions→current_context→tasks', () => {
    const out = handler.buildSystemPrompt(
      baseParams({
        ownerProfile: { name: '阿秋', birthday: '', bio: '' },
        coreMemories: [mem('核心', '核心记忆')],
        document: { contentItemId: 'ci_1', title: 'T', bodyMarkdown: 'x' },
        tasks: [{ title: 't', status: 'pending' }],
      }),
    );
    const order = [
      '<owner>',
      '<role>',
      '<tools>',
      '<memories_index>',
      '<instructions>',
      '<current_context>',
      '<tasks>',
    ].map((tag) => out.indexOf(tag));
    // 每段都存在
    expect(order.every((i) => i >= 0)).toBe(true);
    // 严格递增 = 顺序正确
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
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
