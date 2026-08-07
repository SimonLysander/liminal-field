/**
 * 内置 skill 注册表 —— 产品自带的 skill「是什么」的定义。
 *
 * 载体原则:短元数据在此 ts、长正文(body)在 prompts/skills/*.md。
 * SkillService 解析时「内置(此表) ∪ 用户新建(Mongo)」,内置优先;内置线上不可改,改它=改这里 + md + 部署。
 * 用户在管理 UI 新建的 skill 仍存 Mongo,与此表合并供模型使用。
 */
export interface BuiltinSkillDef {
  /** 稳定 key,即对外的 name(slug);agent 的 enabledSkill 按此 key 引用,不再用 Mongo ObjectId。 */
  key: string;
  displayName: string;
  description: string;
  whenToUse: string;
  /** skill 依赖的工具;装配校验 requiredTools ⊆ agent.tools。 */
  requiredTools: string[];
  /** 长正文文件,相对 prompts/,经 PromptManager.render 加载。 */
  bodyFile: string;
}

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  {
    key: 'note-plan',
    displayName: '规划（思维模型）',
    description:
      '按学习目标与知识依赖研究一个领域，拆成以篇为单位、有因果次序的笔记结构',
    whenToUse:
      '在学习笔记产品中，需要为一个领域生成规划参照稿时使用——研究主题，写出含概要、开篇、篇目脉络与收束的完整总篇规划稿。仅用于学习规划；普通问答、改稿不触发。',
    requiredTools: [],
    bodyFile: 'skills/note-plan.md',
  },
  {
    key: 'note-writing',
    displayName: '成稿（行文）',
    description:
      '把规划好的一篇按中心问题与因果主线写成严谨、可读可审的学习笔记初稿',
    whenToUse:
      '在学习笔记产品中，需要为某一篇生成或续写正文初稿时使用——它规定如何按读者认知和因果主线组织文章、查证并标注出处。仅用于学习笔记成稿；普通问答、给建议、改写他人正文不要触发。',
    requiredTools: ['web_search', 'web_fetch', 'read_content'],
    bodyFile: 'skills/note-writing.md',
  },
  {
    key: 'writing-review',
    displayName: '审稿（质量审查）',
    description:
      '从主旨标题、论证概念、结构推进、节奏可读性和文面错误审查草稿,给出有轻重的修改判断',
    whenToUse:
      '当用户要求审稿、检查问题、评估文章质量、看看哪里不成立、哪里读不顺、是否能发布时使用。用于诊断和修改决策,不直接整篇改写。',
    requiredTools: [],
    bodyFile: 'skills/writing-review.md',
  },
  {
    key: 'explanatory-diagram',
    displayName: '图示（解释设计）',
    description:
      '扫描文章的插图需求，规划多个视觉位置，并逐图指导作者在 Excalidraw 中组织结构、运行和实例信息',
    whenToUse:
      '当用户询问整篇文章哪里需要图、缺少哪些图、如何安排插图，或要求设计某一张解释图时使用。一般性请求先扫描当前草稿并输出多图规划；明确指向选区、章节或规划编号时再输出逐步绘制方案。不生成图片，不插入或修改正文。',
    requiredTools: ['web_search', 'web_fetch'],
    bodyFile: 'skills/explanatory-diagram.md',
  },
];
