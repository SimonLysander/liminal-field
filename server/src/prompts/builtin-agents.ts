/**
 * 内置 agent 注册表 —— 产品自带 agent「是什么」的定义。
 *
 * 载体原则:短元数据(key/name/tools/挂哪些 skill/档位)在此 ts、长 systemPrompt 在 prompts/agents/*.md。
 * 解析时(SystemConfigService.getAgentConfig / getConfigView)以本表为准合成内置 agent:
 *   - 定义(systemPrompt/tools/enabledSkillKeys/tier)以文件为准,线上不可改;
 *   - provider 绑定与 enabled 开关以 Mongo 为准(管理员在 UI 运行时可调,见「配置归属准则」)。
 * 用户在 UI 新建的 agent 仍整条存 Mongo,与内置合并。enabledSkillKeys 直接引用 skill 的 key。
 */
export interface BuiltinAgentDef {
  key: string;
  name: string;
  description: string;
  /** 工具白名单(load_skill 不列其中:enabledSkillKeys 非空时装配层自动挂)。 */
  tools: string[];
  /** 启用的 skill,按 key 引用内置 skill(SkillService 文件优先解析)。 */
  enabledSkillKeys: string[];
  tier: string;
  /** systemPrompt 文件,相对 prompts/;省略则 systemPrompt 为空(如写作顾问靠 Aurora 角色定义)。 */
  promptFile?: string;
}

export const BUILTIN_AGENTS: BuiltinAgentDef[] = [
  {
    key: 'writing-advisor',
    name: '写作顾问',
    description: '帮助改善文章结构、逻辑脉络和表达方式',
    tools: [
      'search_knowledge_base',
      'list_knowledge_base',
      'read_document_content',
      'get_current_draft',
      'read_collection_entry',
      'remember',
      'recall_memory',
      'search_memories',
      'sub_agent',
      'write_tasks',
      'read_conversation_history',
      'web_search',
      'web_fetch',
    ],
    enabledSkillKeys: [],
    tier: 'standard',
    // 无 promptFile:写作顾问 systemPrompt 留空,靠 Aurora 角色定义驱动
  },
  {
    key: 'gallery-caption-writer',
    name: '图说写手',
    description: '为画廊照片写/改图说(caption)',
    tools: ['get_current_draft', 'view_photos', 'propose_caption'],
    enabledSkillKeys: [],
    tier: 'vision',
    promptFile: 'agents/gallery-caption-writer.md',
  },
  {
    key: 'report-analyst',
    name: '报告分析师',
    description: '帮用户深挖简报内容，追问细节与论点',
    tools: ['browse', 'web_search', 'web_fetch'],
    enabledSkillKeys: [],
    tier: 'standard',
    promptFile: 'settings/digest-report-analyst.md',
  },
  {
    key: 'learning-planner',
    name: '学习规划师',
    description: '按第一性原理研究领域,规划「理解 + 篇目结构」',
    tools: [
      'write_learn_plan',
      'read_content',
      'list_knowledge_base',
      'web_search',
      'web_fetch',
      'sub_agent',
    ],
    enabledSkillKeys: ['note-plan'],
    tier: 'standard',
    promptFile: 'agents/learning-planner.md',
  },
  {
    key: 'learning-writer',
    name: '学习写手',
    description: '逐篇研究领域，按行文逻辑（立锚→建模→兑现）起草初稿',
    tools: [
      'read_content',
      'write_draft',
      'web_search',
      'web_fetch',
      'sub_agent',
    ],
    enabledSkillKeys: ['note-writing'],
    tier: 'standard',
    promptFile: 'agents/learning-writer.md',
  },
];
