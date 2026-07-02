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
      '按第一性原理+因果拓扑研究一个领域,拆成以篇为单位、有因果次序的笔记结构',
    whenToUse:
      '在学习笔记产品中,需要为一个领域做规划时使用——研究它、立底层原理为锚、自上而下推出该学哪些篇及其次序,产出「理解 + 笔记结构」。仅用于学习规划;普通问答、改稿不触发。',
    requiredTools: [],
    bodyFile: 'skills/note-plan.md',
  },
  {
    key: 'note-writing',
    displayName: '成稿（行文）',
    description:
      '把规划好的一篇,按 立锚→建模→兑现 写成严谨、可读可审的教科书式学习笔记初稿',
    whenToUse:
      '在学习笔记产品中,需要为某一篇生成或续写正文初稿时使用——它规定这一篇的行文逻辑(立锚→建模→兑现)与文风。仅用于学习笔记成稿;普通问答、给建议、改写他人正文不要触发。',
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
];
