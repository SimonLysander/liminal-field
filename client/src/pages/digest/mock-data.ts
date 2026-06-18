/**
 * digest 页面共享 mock 数据 + 类型。
 * 独立文件避免与 React 组件混合 export（react-refresh/only-export-components）。
 * task #38 接真实 API 后此文件可删除。
 */

export interface PublicTopic {
  id: string;
  name: string;
  /** 一句话专栏定位，用于目录页列表行副标题 */
  tagline: string;
  description: string;
  sourceCount: number;
  cronLabel: string;
  lastReportAt: string; // ISO
  lastReportHits: number;
}

export interface MockPick {
  title: string;
  source: string;
  url: string;
  snippet: string;
}

export interface MockReport {
  id: string;
  topicId: string;
  date: string; // ISO
  picks: MockPick[];
  /** 期号（1-based，决定展示"第 N 期"；接 API 后由服务端提供） */
  issueNumber: number;
  /** 本期编辑标题（可选，无则默认"本期精选"） */
  headline?: string;
}

export const MOCK_TOPICS: PublicTopic[] = [
  {
    id: 'ci_topic_ai001',
    name: 'AI 应用发展',
    tagline: '大模型 / Agent 框架 / 产品形态 / 行业动向',
    description: '关注大模型应用、agent 框架、产品形态、行业资讯',
    sourceCount: 3,
    cronLabel: '每天更新',
    lastReportAt: '2026-06-18T08:00:00Z',
    lastReportHits: 5,
  },
  {
    id: 'ci_topic_photo02',
    name: '摄影活动举办',
    tagline: '国内外摄影展 / 比赛 / 工作坊 / 新书发布',
    description: '关注国内外摄影展、比赛、工作坊、新书发布',
    sourceCount: 2,
    cronLabel: '每周更新',
    lastReportAt: '2026-06-17T09:00:00Z',
    lastReportHits: 2,
  },
  {
    id: 'ci_topic_writing',
    name: '写作 · 叙事 · 文学',
    tagline: '创作技艺 / 叙事理论 / 文学评论 / 出版动态',
    description: '关注创作技艺、叙事理论、文学评论、出版动态',
    sourceCount: 4,
    cronLabel: '每 3 天更新',
    lastReportAt: '2026-06-15T00:00:00Z',
    lastReportHits: 8,
  },
];

/** ci_topic_ai001 各期 picks（按日期倒序，索引 0 = 最新） */
const AI_PICKS_POOL: MockPick[][] = [
  // 6/18
  [
    { title: 'Anthropic 发布 Claude 4.7：上下文 200K、Agent 工具调用更稳', source: 'Anthropic Blog', url: 'https://example.com/1', snippet: '本次更新主要改进了长程任务的连贯性，以及多轮工具调用的可控性...' },
    { title: 'OpenAI 推出 Codex 接班人，主打 IDE 深度集成', source: 'Hacker News', url: 'https://example.com/2', snippet: '继 Codex 之后，OpenAI 在 IDE 内嵌方向上又有新动作...' },
    { title: 'agent 框架对比：LangGraph vs Plate-Agent vs PydanticAI', source: 'Paul Graham Essays', url: 'https://example.com/3', snippet: '三种框架在状态管理、工具调用、可观测性方面的取舍...' },
    { title: 'Browser-use 新版本：原生支持 Chrome DevTools Protocol', source: 'LessWrong', url: 'https://example.com/4', snippet: '相比 Playwright 后端，CDP 的优势在于...' },
    { title: '小型 Agent 框架对比测试：超越 LangGraph 的代价', source: '少数派', url: 'https://example.com/5', snippet: '把 LangGraph 换成自家框架后，团队从 5 人减到 2 人...' },
  ],
  // 6/17
  [
    { title: 'Gemini 2.0 Flash 新增实时视频理解能力', source: 'Google AI Blog', url: 'https://example.com/6', snippet: '视频帧理解延迟从 800ms 降到 120ms，适合 robotics 场景...' },
    { title: 'Claude API 批量处理（Batch API）性价比评测', source: 'Hacker News', url: 'https://example.com/7', snippet: '相比实时 API，Batch API 成本降 70%，延迟换吞吐的典型取舍...' },
    { title: 'Meta 开源 Llama 3.2：多模态首次入列', source: 'Meta AI', url: 'https://example.com/8', snippet: '11B/90B 视觉模型，image reasoning 超越 Claude 3 Haiku...' },
  ],
  // 6/16
  [
    { title: 'Cursor 1.0 正式发布：从辅助到 Agent 范式转变', source: 'Cursor Blog', url: 'https://example.com/9', snippet: 'Background Agent 可离线跑 30 分钟任务，背后是 Claude + Gemini 混用...' },
    { title: 'Windsurf 推出 MCP 本地执行支持', source: 'Hacker News', url: 'https://example.com/10', snippet: 'MCP server 可在本地沙箱执行，解决远端隐私问题...' },
  ],
  // 6/15
  [
    { title: '深度研究：AI coding agent 的上下文管理策略', source: 'Simon Willison Blog', url: 'https://example.com/11', snippet: '深入对比 Claude Code / Aider / Devin 如何处理超长上下文...' },
    { title: 'OpenAI 宣布 o3-mini 降价 80%', source: 'OpenAI News', url: 'https://example.com/12', snippet: '推理模型战场进一步卷向成本，小参数高推理成主流...' },
    { title: 'Cohere 开源 Aya Expanse 多语言模型', source: 'Cohere Blog', url: 'https://example.com/13', snippet: '支持 23 种语言的长文本模型，中文表现达 GPT-4o 水平...' },
    { title: '评论：AI 工具替代了哪些「第一个小时」工作', source: '少数派', url: 'https://example.com/14', snippet: '调研 500 名开发者的工作流，AI 替代了启动、搜索、草拟三类...' },
  ],
  // 6/14
  [
    { title: 'DeepMind AlphaFold 3 新数据集开放', source: 'DeepMind Blog', url: 'https://example.com/15', snippet: '蛋白质 + 小分子联合结构预测数据集，覆盖 8000+ 复合物...' },
    { title: 'Mistral Large 2 发布：128K 上下文', source: 'Mistral AI', url: 'https://example.com/16', snippet: '欧洲最强闭源模型更新，函数调用能力大幅改进...' },
  ],
];

export const MOCK_REPORTS: MockReport[] = [
  // ci_topic_ai001：5 份（6/14-6/18 每天一份，issueNumber 倒序：5=最新）
  { id: 'ci_report_001', topicId: 'ci_topic_ai001', date: '2026-06-18T08:00:00Z', picks: AI_PICKS_POOL[0], issueNumber: 5, headline: 'Claude 4.7、Codex 接班人与 Agent 框架战场' },
  { id: 'ci_report_002', topicId: 'ci_topic_ai001', date: '2026-06-17T08:00:00Z', picks: AI_PICKS_POOL[1], issueNumber: 4, headline: 'Gemini 实时视频 + 批量 API 成本评测' },
  { id: 'ci_report_003', topicId: 'ci_topic_ai001', date: '2026-06-16T08:00:00Z', picks: AI_PICKS_POOL[2], issueNumber: 3, headline: 'Cursor 1.0 正式发布：从辅助到 Agent 范式' },
  { id: 'ci_report_004', topicId: 'ci_topic_ai001', date: '2026-06-15T08:00:00Z', picks: AI_PICKS_POOL[3], issueNumber: 2, headline: '上下文管理策略与推理模型降价潮' },
  { id: 'ci_report_005', topicId: 'ci_topic_ai001', date: '2026-06-14T08:00:00Z', picks: AI_PICKS_POOL[4], issueNumber: 1 },
  // ci_topic_photo02：2 份
  {
    id: 'ci_report_p01',
    topicId: 'ci_topic_photo02',
    date: '2026-06-17T09:00:00Z',
    picks: [
      { title: '第十届北京国际摄影周征稿截止延期通知', source: '摄影世界', url: 'https://example.com/p1', snippet: '主办方宣布截稿日期延至 7 月 15 日，面向全球摄影师开放投稿...' },
      { title: 'PhotoShanghai 2026 参展艺术家公布', source: '艺术中国', url: 'https://example.com/p2', snippet: '今年聚焦「城市与自然」主题，来自 28 国的 120 位摄影师参与...' },
    ],
    issueNumber: 2,
    headline: '北京摄影周延期 + PhotoShanghai 艺术家公布',
  },
  {
    id: 'ci_report_p02',
    topicId: 'ci_topic_photo02',
    date: '2026-06-10T09:00:00Z',
    picks: [
      { title: 'PHOTOFAIRS Shanghai 2026 开幕在即', source: '艺术圈', url: 'https://example.com/p3', snippet: '展会聚焦新兴亚洲影像创作者，将于 6 月 20 日开幕...' },
    ],
    issueNumber: 1,
  },
  // ci_topic_writing：0 份（空态）
];
