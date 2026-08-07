import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_AGENTS } from '../builtin-agents';

function prompt(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

describe('面向用户的生成文本规范', () => {
  it('专业书面语契约只挂载到目标 agent 并明确不可由用户指令覆盖', () => {
    const contractPath = 'agents/user-facing-prose-contract.md';
    const contract = prompt(contractPath);
    const byKey = new Map(BUILTIN_AGENTS.map((agent) => [agent.key, agent]));

    expect(contract).toContain('专业书面语');
    expect(contract).toContain('口语俗词');
    expect(contract).toContain('不因用户');
    for (const key of [
      'writing-advisor',
      'learning-planner',
      'learning-writer',
      'report-analyst',
    ]) {
      expect(byKey.get(key)?.contextPromptFiles).toContain(contractPath);
    }
    expect(
      byKey.get('gallery-caption-writer')?.contextPromptFiles ?? [],
    ).not.toContain(contractPath);
  });

  it('学习初稿与规划采用教科书式严谨表述', () => {
    for (const file of ['skills/note-writing.md', 'skills/note-plan.md']) {
      const content = prompt(file);
      expect(content).toContain('教科书式严谨');
      expect(content).toContain('详尽但不啰嗦');
      expect(content).toContain('概念边界');
      expect(content).toContain('术语');
      expect(content).toContain('推进新的理解');
      expect(content).toContain('归纳、连接或应用');
    }
  });

  it('初稿审批摘要说明使用规范书面语', () => {
    const content = prompt('../modules/agent/tools/write-draft.tool.ts');
    expect(content).toContain('教科书式严谨');
    expect(content).not.toMatch(/一眼看懂|讲清这篇/);
  });

  it('简报采用专业事实编辑风格且提示词不含口语诱导词', () => {
    const files = [
      'digest/compose-plan.md',
      'digest/compose-write-section.md',
      'settings/digest-report-analyst.md',
    ];
    const contents = files.map(prompt);

    for (const content of contents) {
      expect(content).toContain('专业事实编辑');
    }
    expect(contents[0]).not.toContain('{{findings_list}}');
    expect(contents[1]).not.toContain('{{sources_xml}}');
    for (const content of contents) {
      expect(content).not.toMatch(
        /水稿|不水|补刀|注水|摆在一起|真标题|不靠谱|死路|别硬凑|别硬拆/,
      );
    }
  });

  it('行内续写保持正文体裁但不复制口语表达', () => {
    const content = prompt('inline-assist/continue-system.md');

    expect(content).toContain('规范书面语');
    expect(content).toContain('原文或用户指令');
    expect(content).not.toContain('保持原文的语言、语气');
  });

  it('对话与审稿提示词不使用会诱导输出的口语判断', () => {
    const content = [
      prompt('agents/writing-advisor.md'),
      prompt('skills/writing-review.md'),
    ].join('\n');

    expect(content).not.toMatch(/卡在哪里|撑得住|太漂亮但/);
  });

  it('图示 skill 先规划整篇候选，再按编号展开单图', () => {
    const content = prompt('skills/explanatory-diagram.md');

    expect(content).toContain('整篇插图规划');
    expect(content).toContain('单图设计');
    expect(content).toContain('标题路径 + 语义锚点');
    expect(content).toContain('对象集合相同且解释问题相同');
    expect(content).toContain('再依据每个候选的第一个语义锚点');
    expect(content).toContain('必须继承该候选的解释任务和范围');
    expect(content).toContain('模型自身掌握的背景知识不算已经确认');
    expect(content).toContain('使用当前入口提供的 `web_search` 和 `web_fetch`');
    expect(content).toContain('用户明确要求只依据正文时');
    expect(content).toContain('不要把静态关系扩写成多个时间快照');
    expect(content).toContain('不能据此增加启动状态、结束状态');
    expect(content).toContain('规划模式不输出具体形状、颜色和绘制步骤');
    expect(content).toContain('输出中不使用 `px`');
    expect(content).toContain('是否能够回溯到当前文稿');
    expect(content).toContain('没有对应依据的视觉元素不进入最终方案');
    expect(content).toContain('增加“依据补充”');
    expect(content).toContain('结构层加运行层和实例层');
    expect(content).not.toMatch(
      /一眼看懂|拉出来|心中有数|好东西不能同时要|确认逻辑落地/,
    );
  });
});
