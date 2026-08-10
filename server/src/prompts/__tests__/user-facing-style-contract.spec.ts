import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_AGENTS } from '../builtin-agents';

function prompt(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
}

describe('面向用户的生成文本规范', () => {
  it('公共约定要求工具调用前不播报内部过程', () => {
    const content = prompt('aurora/conventions.md');

    expect(content).toContain('需要调用工具时直接调用');
    expect(content).toContain('不在调用前播报读取、加载、检索或检查计划');
  });

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

  it('图示 skill 先规划整篇候选，再按编号生成自包含的参考图提示词', () => {
    const content = prompt('skills/explanatory-diagram.md');

    expect(content).toContain('整篇插图规划');
    expect(content).toContain('单图参考提示词');
    expect(content).toContain('不能在已经得到若干候选后提前停止');
    expect(content).toContain('整篇扫描只识别当前草稿与本次对话');
    expect(content).toContain('需要查证的内容留到用户选定单图后处理');
    expect(content).toContain('不能进一步写出两个对象的启动次序');
    expect(content).toContain('标题必须给出合并后的插图总数');
    expect(content).toContain('## 插图规划：共 N 张');
    expect(content).toContain('整篇规划是候选清单，不是缩略版设计稿');
    expect(content).toContain('名称承担解释任务');
    expect(content).toContain('按文章标题分组');
    expect(content).toContain('不要求每项附带说明段落');
    expect(content).toContain('不能把关系提前翻译成具体画法');
    expect(content).toContain(
      '删除其中的价值论证、读者心理过程、对象排布、画面数量、颜色、形状、参数组合、运行细节和绘制方式',
    );
    expect(content).toContain(
      '需要观察真实外观或画面效果时优先使用照片或技术插图',
    );
    expect(content).toContain('规划不使用“读者需要”“在脑中”“图示可以”等句式');
    expect(content).toContain('不逐项添加“本图只负责……”');
    expect(content).toContain('标题路径 + 语义锚点');
    expect(content).toContain('对象集合相同且解释问题相同');
    expect(content).toContain('再依据每个候选的第一个语义锚点');
    expect(content).toContain('必须继承该候选的解释任务和范围');
    expect(content).toContain('模型自身掌握的背景知识不算已经确认');
    expect(content).toContain('使用当前入口提供的 `web_search` 和 `web_fetch`');
    expect(content).toContain('用户明确要求只依据正文时');
    expect(content).toContain('不要把静态关系扩写成多个时间快照');
    expect(content).toContain('不能增加已完成、正在进行或尚未开始等状态');
    expect(content).toContain(
      '不输出具体形状、颜色、参数组合、运行细节和绘制步骤',
    );
    expect(content).toContain('输出中不使用 `px`');
    expect(content).toContain('将专业概念转换为可见对象');
    expect(content).toContain('区分语义事实与中性构图选择');
    expect(content).toContain('事实准确、解释边界、画面完整、视觉丰富');
    expect(content).toContain('正文事实 → 视觉元素');
    expect(content).toContain('不得先补造事实，再用“示意”降低其确定程度');
    expect(content).toContain('不使用模型记忆解释术语');
    expect(content).toContain('不能规定 A 与 B 谁先启动、是否延迟、是否同速');
    expect(content).toContain('不得为了避免“若干”“适当”等模糊表述而编造精确值');
    expect(content).toContain(
      '详细”指画面中的对象、关系、标签和视觉编码没有遗漏',
    );
    expect(content).toContain('提示词一律不写画面占比、对象宽高比');
    expect(content).toContain('不以百分数、分数或倍数表达尺寸');
    expect(content).toContain('检查所有构图语句并删除“百分之”“分之一”');
    expect(content).toContain('每类对象的示意形态、标签和相对关系');
    expect(content).toContain('提示词应描述完成后的画面');
    expect(content).toContain('生图提示词必须脱离当前对话和文章也能独立使用');
    expect(content).toContain('回答以生图提示词代码块结束');
    expect(content).toContain('回答直接从该标题开始');
    expect(content).toContain('标题下只用一句自然语言说明插入位置和解释用途');
    expect(content).toContain(
      '不添加事实摘要、过程说明、分隔线、“生图提示词”小标题',
    );
    expect(content).toContain('需要降低视觉权重时使用更浅的颜色档位');
    expect(content).toContain('是否能够回溯到当前文稿');
    expect(content).toContain('没有对应依据的内容不进入最终提示词');
    expect(content).toContain('增加一句“补充依据：”');
    expect(content).toContain('结构层加运行层和实例层');
    expect(content).not.toMatch(
      /一眼看懂|拉出来|心中有数|好东西不能同时要|确认逻辑落地/,
    );
  });
});
