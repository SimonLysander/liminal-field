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
  /** 副标题：新闻里带视角/情绪的一句话定性 */
  subtitle: string;
  source: string;
  url: string;
  snippet: string;
  /** 完整正文段落（3-5 段，每段 60-120 字）。为空则 fallback 到简讯 layout */
  paragraphs: string[];
  /** 预估阅读时长，如 "3 分钟" */
  readingTime?: string;
}

export interface MockReport {
  id: string;
  topicId: string;
  date: string; // ISO
  picks: MockPick[];
  /** 期号（1-based，决定展示"第 N 期"；接 API 后由服务端提供） */
  issueNumber: number;
  /** 本期编辑标题（可选，无则默认"本期简报"） */
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

/* ================================================================
 * ci_topic_ai001 — AI 应用发展，5 期完整正文
 * ================================================================ */

const AI_PICKS_POOL: MockPick[][] = [
  // ── 第 5 期 · 2026-06-18 ──
  [
    {
      title: 'Anthropic 发布 Claude 4.7：上下文 200K、Agent 工具调用更稳',
      subtitle: '长程任务连贯性显著改善，工具调用支持并行化',
      source: 'Anthropic Blog',
      url: 'https://example.com/1',
      snippet: '本次更新主要改进了长程任务的连贯性，以及多轮工具调用的可控性...',
      readingTime: '4 分钟',
      paragraphs: [
        '北京时间昨日凌晨，Anthropic 正式发布 Claude 4.7，主打"长程任务连贯性"与"多轮工具调用稳定性"两项改进。官方称在内部 SWE-bench 测试中，连续 30 步工具调用的成功率从 4.6 的 62% 提升至 81%，这一数字被认为是 Agent 工程化成熟度的关键指标。',
        '新模型上下文窗口扩展至 200K tokens，针对 codebase 级任务做了 cache 优化。对比 GPT-5 在相同长度下的延迟与吐字速度，Claude 4.7 在长文本前缀缓存场景下的首字延迟降低约 35%，在实际的 IDE 集成场景中有显著感受差异。',
        '工具调用方面，新版引入"工具调用计划阶段"——模型在执行前会先输出工具调用 DAG 草图供 host 端审核或并行化执行。这一改动尤其受到 IDE 集成场景的欢迎：Cursor 和 Windsurf 团队均在第一时间发布了集成公告，并称并行化执行让某些场景速度提升 2-3 倍。',
        '社区的反应分两类：一类认为这是 Agent 工程化的关键一步，称"模型终于开始理解自己在执行 DAG 而不是顺序脚本"；另一类则指出 200K 窗口在实际 codebase 中仍是杯水车薪，期待下一代 1M token 模型，并在 HN 帖子里晒出了"填满 200K 的 monorepo 目录树截图"。',
        'Anthropic 定价保持与 4.6 持平，并宣布旧版将在 90 天后下线。对于依赖 4.5/4.6 API 的团队而言，迁移窗口相对充裕，但"工具调用计划阶段"的输出格式变化仍需代码适配，建议提前在测试环境跑回归。',
      ],
    },
    {
      title: 'OpenAI 推出 Codex 接班人，主打 IDE 深度集成',
      subtitle: '代码助手战场再升温，本地执行与隐私成核心卖点',
      source: 'Hacker News',
      url: 'https://example.com/2',
      snippet: '继 Codex 之后，OpenAI 在 IDE 内嵌方向上又有新动作...',
      readingTime: '3 分钟',
      paragraphs: [
        'OpenAI 在周三的开发者活动上低调公布了 Codex 接班项目，内部代号"Atlas"。与初代 Codex 主要用于代码补全不同，Atlas 定位为"代码库理解引擎"，能够在无需上传代码的情况下，通过 LSP 协议在本地实时读取当前项目的符号表和调用图。',
        '最核心的差异化在于本地索引策略：Atlas 在用户机器上维护一个轻量级向量索引，仅在查询时将压缩后的上下文摘要发送到 OpenAI 服务器，而非将完整代码上传。这一设计直接回应了 Copilot 长期以来的隐私争议，也是 JetBrains 等 IDE 厂商在采购谈判中的核心顾虑。',
        '从技术栈看，Atlas 底层调用 o3-mini 做推理，用 GPT-4o 做代码补全，用专训的 embedding 模型做本地检索。三模型协作的架构导致延迟并不突出，Hacker News 评论区有用户晒出"首个 token 平均 1.4 秒"的实测数据，比 Copilot 的 0.6 秒慢了不少。',
        '目前 Atlas 处于邀请制 Beta 阶段，支持 VS Code 和 JetBrains 系，Neovim 支持"正在路上"。开发者可以通过 OpenAI 开发者控制台申请早期访问，预计 Q3 正式 GA。定价暂未公布，但据参加活动的开发者透露，团队版将按座位收费，价格在 Copilot Business 的 1.5-2 倍区间。',
      ],
    },
    {
      title: 'Agent 框架对比：LangGraph vs Plate-Agent vs PydanticAI',
      subtitle: '状态管理哲学的分歧，决定了框架的天花板',
      source: 'Paul Graham Essays',
      url: 'https://example.com/3',
      snippet: '三种框架在状态管理、工具调用、可观测性方面的取舍...',
      readingTime: '5 分钟',
      paragraphs: [
        '本周 Simon Willison 发布了一篇详尽的 Agent 框架横评，对比对象是目前社区使用量最大的三个框架：LangGraph（LangChain 出品）、Plate-Agent（独立开源）、PydanticAI（Pydantic 团队出品）。三者的核心分歧，在于如何建模"Agent 状态"。',
        'LangGraph 用有向图（DAG/CycleGraph）描述 Agent 的执行流，状态作为节点间传递的可序列化 dict。优点是流程可视化、断点续传天然支持；缺点是复杂图的 debug 体验极差，且框架的抽象层过厚，遇到边界情况时开发者常常不知道哪一层出了问题。',
        'PydanticAI 走"类型优先"路线，Agent 的 input/output/state 全部用 Pydantic model 定义，工具调用的入参出参也经过严格 schema 校验。这一设计让 IDE 的类型提示体验极佳，但对复杂的非线性流程支持较弱，适合"结构化输入 → 结构化输出"的场景，而非需要大量动态分支的长程 Agent。',
        'Plate-Agent 是三者中最年轻的，核心理念是"Agent 就是带工具的状态机"，强制要求开发者显式定义状态转移规则，类似于 XState 的 Actor 模型。可观测性最好——每个状态转移都会产生结构化事件，可以直接接 OpenTelemetry；但上手曲线最陡，学习成本约是 LangGraph 的 2 倍。',
        '综合建议：快速原型和教学场景选 LangGraph；生产级、需要类型安全的场景选 PydanticAI；需要长程稳定性和可观测性、愿意投入学习成本的团队选 Plate-Agent。三者都在快速演进，今日的对比结论可能半年后已过时。',
      ],
    },
    {
      title: 'Browser-use 新版本：原生支持 Chrome DevTools Protocol',
      subtitle: '告别 Playwright 绕路，WebAgent 的延迟降了 40%',
      source: 'LessWrong',
      url: 'https://example.com/4',
      snippet: '相比 Playwright 后端，CDP 的优势在于...',
      readingTime: '3 分钟',
      paragraphs: [
        'Browser-use 是目前 GitHub Stars 增长最快的 WebAgent 框架之一，本周发布了 0.4 版本，最大变化是将底层从 Playwright 切换为原生 Chrome DevTools Protocol（CDP）。这一改动让框架的操控延迟从平均 800ms 降到 480ms，对于需要实时交互的 Agent 任务意义显著。',
        'Playwright 本身是 CDP 的封装，Browser-use 此前依赖 Playwright 意味着每个动作要经过两层封装转换，带来不必要的序列化开销。新版直接调用 CDP，让"截图 → 分析 → 点击"这个最高频循环的耗时缩短了约 40%。代价是失去了 Playwright 的跨浏览器抽象——新版只支持 Chrome/Chromium 系，Firefox 和 Safari 暂时搁置。',
        'LessWrong 社区的讨论集中在另一个变化：新版引入了"视觉模式"和"DOM 模式"可切换的混合策略。视觉模式让模型像人一样"看页面截图"做决策，DOM 模式让模型直接读取结构化 DOM tree。框架现在可以根据页面复杂度自动选择：结构化页面用 DOM（快、省 token）；动态渲染或 canvas 页面用视觉（准）。',
        '值得关注的是，0.4 版同时推出了"会话记忆"功能：Agent 在执行跨多个页面的长任务时，可以将中间结果写入轻量级 session store，重启后从断点继续。这解决了此前 WebAgent 最头疼的问题之一——长任务中途 crash 后只能从头来过。',
      ],
    },
    {
      title: '小型 Agent 框架实战：从 LangGraph 迁移的真实代价',
      subtitle: '从 5 人团队缩到 2 人，框架选择比模型选择更影响人效',
      source: '少数派',
      url: 'https://example.com/5',
      snippet: '把 LangGraph 换成自家框架后，团队从 5 人减到 2 人...',
      readingTime: '4 分钟',
      paragraphs: [
        '少数派本周刊发了一篇来自独立开发者陈睿的深度复盘，记录了他的团队将一个客服 Agent 产品从 LangGraph 迁移到 PydanticAI 的全过程。迁移历时 6 周，最终团队规模从 5 人（3 个后端、1 个 prompt 工程师、1 个测试）缩减到 2 人（1 个全栈、1 个兼职测试），而产品功能覆盖度没有下降。',
        '陈睿总结了 LangGraph 的三个主要成本中心：第一是"图的心智负担"——团队新人需要 2-3 周才能真正理解节点/边/状态的关系，每次改需求都要重新画图确认逻辑；第二是"框架版本的不稳定性"，LangGraph 0.x 时期 API 变化频繁，升级成本极高；第三是测试难度，图执行路径的组合爆炸让单元测试几乎无法覆盖真实场景。',
        '迁移到 PydanticAI 后最大的收益是"代码即文档"：工具的 input/output schema 即 Pydantic model，PR review 时一眼就能看出接口变化；类型错误在 IDE 里实时提示，而非在运行时才暴露。陈睿估算，这一特性让他们的 debug 时间减少了约 60%。',
        '但迁移也有代价。PydanticAI 的流程控制能力较弱，他们有 3 个需要"条件分支 + 循环"的复杂流程不得不手写状态机逻辑，代码量反而比 LangGraph 版多了 30%。陈睿的建议是：如果你的 Agent 逻辑 80% 是线性的，PydanticAI 是更好的选择；如果你需要复杂图结构，LangGraph 的学习成本是值得付出的。',
      ],
    },
  ],

  // ── 第 4 期 · 2026-06-17 ──
  [
    {
      title: 'Gemini 2.0 Flash 新增实时视频理解能力',
      subtitle: '从"看图说话"升级到"看视频行动"，robotics 场景率先受益',
      source: 'Google AI Blog',
      url: 'https://example.com/6',
      snippet: '视频帧理解延迟从 800ms 降到 120ms，适合 robotics 场景...',
      readingTime: '3 分钟',
      paragraphs: [
        'Google 在 I/O 延伸发布中更新了 Gemini 2.0 Flash 的多模态能力，核心改进是将视频流理解的端到端延迟从原来的 800ms 压缩到 120ms。这一数字让实时视频场景的 Agent 应用从"体验可忍受"变为"体验流畅"，尤其对 robotics 和 AR 叠加层等对延迟极度敏感的场景意义重大。',
        '技术上，Google 采用了"关键帧感知采样"策略：模型不再逐帧处理，而是通过轻量级变化检测模块动态决定哪些帧需要深度理解，哪些帧可以跳过。实测数据显示，在"摄像头拍摄桌面操作"场景中，有效帧采样率仅为 15-25%，但理解准确率没有下降。',
        'Flash 版本的定价也同步调整，按"处理帧数"计费而非"输入 token 数"。对于视频密集型应用，新定价模型可能节省 40-60% 的成本，但对于间歇性查询场景，则可能略贵。Google 同时提供了一个迁移估算工具，帮助开发者评估切换成本。',
        '社区讨论最热的是"实时翻译+字幕叠加"场景：有开发者已经用 Gemini Flash 构建了一个实时翻译眼镜原型，在 AR 头显上叠加双语字幕，延迟降低后体验已经接近可用。这类应用如果能规模化，将是 Gemini 进入消费端的重要切入点。',
      ],
    },
    {
      title: 'Claude API 批量处理（Batch API）性价比实测',
      subtitle: '成本降 70% 的代价：你的任务能等多少小时？',
      source: 'Hacker News',
      url: 'https://example.com/7',
      snippet: '相比实时 API，Batch API 成本降 70%，延迟换吞吐的典型取舍...',
      readingTime: '3 分钟',
      paragraphs: [
        'Hacker News 本周有一篇高赞帖子来自一位独立开发者，详细测算了 Anthropic Batch API 相对于实时 API 的实际成价。结论是：对于不需要实时响应的任务（数据标注、批量摘要、离线评估），Batch API 确实能降低约 70% 的 API 费用，但代价是结果返回时间从毫秒级变为"最长 24 小时"。',
        '帖子作者 Mekanism 用自己的"新闻摘要生成"业务做了为期一周的对比测试：实时 API 平均响应 2.1 秒，批量 API 平均返回 4.8 小时，极端情况下超过 20 小时。他的业务是每天早 8 点生成前一天的新闻摘要，因此 24 小时的等待时限完全可以接受，最终成本从每月 $340 降到 $98。',
        '但帖子的最高赞评论提出了一个容易被忽视的成本：批量 API 的错误处理复杂度显著高于实时 API。单条失败时你需要维护一个重试队列，且 Anthropic 目前不提供部分成功的批次状态追踪，调试体验"回到了 2015 年的异步编程时代"。',
        '综合建议：批量 API 适合"任务总量大、单条时限松、可接受异步"的场景，比如数据管道、离线评估、批量内容生成。不适合实时产品功能。对于大多数独立开发者，一个简单的"夜间批处理"设计模式就能获得 60% 以上的成本节省。',
      ],
    },
    {
      title: 'Meta 开源 Llama 3.2：多模态首次入列',
      subtitle: '开源阵营首次有竞争力的视觉模型，生态意义大于技术突破',
      source: 'Meta AI',
      url: 'https://example.com/8',
      snippet: '11B/90B 视觉模型，image reasoning 超越 Claude 3 Haiku...',
      readingTime: '3 分钟',
      paragraphs: [
        'Meta 发布 Llama 3.2，这是 Llama 系列首次纳入原生多模态模型。新版本包含 4 个尺寸：1B、3B（纯文本，面向边端）、11B、90B（多模态，支持图文理解）。多模态版本的发布让 Llama 生态正式进入"图文并举"阶段，对于需要本地部署的企业客户尤其重要。',
        '性能方面，Meta 在官方 blog 中列出的数据显示，11B 视觉模型在多个 image reasoning benchmark 上超越了 Claude 3 Haiku 和 GPT-4o-mini。独立研究者的复现测试基本确认了这一结论，但也指出在"图表理解"和"手写文字识别"等细分任务上，11B 版本仍落后于 GPT-4o-mini 约 8-12 个百分点。',
        '开源许可证方面，Llama 3.2 沿用了修改版的 Llama Community License，允许商业使用，但月活超过 7 亿用户的企业需要单独申请许可。这一门槛将绝大多数使用场景纳入免费区间，但也引发了社区关于"这是否算真正开源"的老争论。',
        '生态层面，Hugging Face、Ollama、LM Studio 均在发布后数小时内完成了模型适配，用户可以通过 `ollama pull llama3.2-vision` 一行命令在本地运行 11B 视觉模型。这种"社区即基础设施"的生态壁垒，才是 Meta 选择开源的真正战略意图。',
      ],
    },
  ],

  // ── 第 3 期 · 2026-06-16 ──
  [
    {
      title: 'Cursor 1.0 正式发布：从辅助到 Agent 范式转变',
      subtitle: 'Background Agent 能离线跑半小时，IDE 的定义正在被重写',
      source: 'Cursor Blog',
      url: 'https://example.com/9',
      snippet: 'Background Agent 可离线跑 30 分钟任务，背后是 Claude + Gemini 混用...',
      readingTime: '4 分钟',
      paragraphs: [
        'Cursor 发布 1.0，标志着这款 AI 编辑器从"补全增强"正式转型为"Agent 驱动的编程环境"。最引人注目的新功能是 Background Agent——用户可以将一个需要 30 分钟以上的任务（如"给这个模块补全测试覆盖率到 80%"）提交给 Agent，然后关掉电脑去睡觉，次日醒来查看结果。',
        '从技术架构看，Background Agent 采用"Claude 做计划、Gemini Flash 做执行"的混合策略：Claude 负责理解任务意图并分解为步骤，Gemini Flash 以更低成本高速执行具体的文件读写和测试运行操作。这种"大模型做规划、小模型做执行"的分层架构，已经成为 AI coding agent 的主流范式。',
        'Cursor 团队公布了一组内部数据：在 1000 个"新增功能"类任务中，Background Agent 能够在无人干预的情况下成功完成约 34%，需要用户介入一次才能完成约 41%，剩余 25% 的任务需要多次介入或完全失败。这个数字远未达到"自动化一切"，但已经足以覆盖大量重复性开发工作。',
        '商业模式上，Background Agent 作为付费功能，每月按"Agent 分钟数"计费，基础套餐含 600 分钟/月（约 20 个 30 分钟任务）。社区对定价的反应两极分化：独立开发者认为对个人用户过贵；企业用户则认为如果每个 Agent 任务能节省 2 小时人工，ROI 极其显著。',
        '1.0 的另一个重要变化是 MCP（Model Context Protocol）的深度集成，Cursor 现在可以通过 MCP server 调用外部工具（数据库、API、文件系统），将 Agent 的能力边界从"单个 codebase"扩展到"整个开发环境"。这一变化的深远影响，可能要到 6-12 个月后才能充分显现。',
      ],
    },
    {
      title: 'Windsurf 推出 MCP 本地执行支持',
      subtitle: '隐私优先的 MCP 策略，能否打开企业市场的大门？',
      source: 'Hacker News',
      url: 'https://example.com/10',
      snippet: 'MCP server 可在本地沙箱执行，解决远端隐私问题...',
      readingTime: '2 分钟',
      paragraphs: [
        'Windsurf（前 Codeium）本周更新，核心亮点是"MCP 本地沙箱执行"：MCP server 不再需要部署在远程服务器，可以在用户本机的轻量级容器中运行，代码和数据完全不离开本地环境。这一设计直接对准了企业客户最敏感的合规痛点。',
        '从实现上看，Windsurf 使用了 Deno Deploy 的子集作为本地运行时，提供 V8 隔离的执行沙箱。每个 MCP server 运行在独立的进程中，相互隔离，且所有网络出站请求默认被拦截，需要用户显式配置白名单。这一设计比"本地进程直接执行"安全得多，也比"远程 Docker 容器"轻量得多。',
        'Hacker News 评论区的反应主要分两类：安全从业者认为"隔离思路对，但需要正式的安全审计才能在企业内推广"；中小型团队则认为"终于可以把公司代码接进去了"。Windsurf 官方表示正在准备 SOC 2 Type II 认证，预计 Q4 完成。',
      ],
    },
  ],

  // ── 第 2 期 · 2026-06-15 ──
  [
    {
      title: '深度研究：AI coding agent 的上下文管理策略',
      subtitle: '长上下文窗口是工具，不是银弹——三款 agent 的不同选择',
      source: 'Simon Willison Blog',
      url: 'https://example.com/11',
      snippet: '深入对比 Claude Code / Aider / Devin 如何处理超长上下文...',
      readingTime: '5 分钟',
      paragraphs: [
        'Simon Willison 发布了一篇长文，深度对比 Claude Code、Aider、Devin 三款 AI coding agent 在处理超长上下文时的不同策略。核心问题是：当一个 codebase 超出模型的上下文窗口时，agent 应该怎么办？三款工具给出了截然不同的答案。',
        'Claude Code 的策略是"主动压缩"：当对话接近窗口上限时，模型会自动触发上下文压缩，将历史对话总结为结构化摘要，保留关键决策和文件变更记录，丢弃冗余的中间过程。这一设计对用户透明，但有时会丢失重要的中间步骤，导致 agent"忘记了三步前做了什么"。',
        'Aider 走"精确选择"路线：在每次请求前，用户（或自动策略）显式指定哪些文件放入上下文，其余文件提供压缩后的"地图"。这一策略让上下文利用率极高，但需要用户有足够的代码理解能力来做出正确选择，对新手不友好。',
        'Devin 的策略最复杂，也最不透明：它维护一个结构化的"工作记忆"，包括当前任务的目标、已完成步骤、待执行步骤和已知约束，独立于对话上下文存储。每次 LLM 调用时，Devin 动态组装"必要上下文"，不完全依赖对话历史。这一设计理论上最优，但实现复杂度极高，且出错时极难 debug。',
        'Willison 的结论：没有完美的上下文管理策略，关键是选择与自己工作流匹配的那一种。对于探索性任务，Claude Code 的透明压缩最友好；对于大型 codebase 的精准修改，Aider 的显式选择最可控；对于需要长程自主执行的任务，Devin 的结构化记忆最稳定。',
      ],
    },
    {
      title: 'OpenAI 宣布 o3-mini 降价 80%',
      subtitle: '推理模型战场进入价格战，谁的 margin 最先撑不住？',
      source: 'OpenAI News',
      url: 'https://example.com/12',
      snippet: '推理模型战场进一步卷向成本，小参数高推理成主流...',
      readingTime: '2 分钟',
      paragraphs: [
        'OpenAI 宣布 o3-mini 降价 80%，输入从 $3/1M tokens 降到 $0.60，输出从 $12/1M 降到 $2.40。这是 o 系列推理模型自发布以来最大幅度的单次降价。官方将这次降价归因于"基础设施效率持续提升"，但业界普遍认为，这是对 Gemini 2.5 Flash 和 DeepSeek R2 竞争压力的直接回应。',
        '降价后 o3-mini 的性价比产生了有趣的重叠区域：对于需要"一定推理深度但不需要 o3 完整能力"的场景，o3-mini 现在与 GPT-4o 的价格基本持平，但在数学推理和代码调试上有明显优势。多家独立测评机构已经开始更新他们的"性价比推荐矩阵"。',
        '降价也引发了关于 OpenAI 定价策略的讨论：以这个速度，GPT-5 级别的能力何时能达到 GPT-4o 今天的价格？有分析师引用半导体行业的"学习曲线"模型预测，到 2027 年末，今天 GPT-5 的能力将以现在 GPT-4o-mini 的价格提供。若这一预测成真，大量"靠卖 AI 赋能"的 SaaS 产品的护城河将大幅收窄。',
      ],
    },
    {
      title: 'Cohere 开源 Aya Expanse 多语言模型',
      subtitle: '23 种语言、中文达 GPT-4o 水平，开源多语言进入新纪元',
      source: 'Cohere Blog',
      url: 'https://example.com/13',
      snippet: '支持 23 种语言的长文本模型，中文表现达 GPT-4o 水平...',
      readingTime: '2 分钟',
      paragraphs: [
        'Cohere 开源了 Aya Expanse 系列多语言模型（8B 和 32B），支持包括中文、阿拉伯语、印度语系、斯瓦希里语在内的 23 种语言。这是目前开源社区语言覆盖最广的模型之一，对于非英语 AI 应用开发者而言，是一个值得认真评估的选项。',
        '在中文测评上，Cohere 引用了 C-Eval 和 CMMLU 两个主流基准的数据，32B 版本的得分接近 GPT-4o 的 90%，超越了同尺寸的 Llama 3 系列约 6-8 个百分点。独立测评者的非正式测试基本支持这一结论，但也指出在"需要实时信息的问答"和"复杂指令跟随"场景上仍有差距。',
        '许可证方面，Aya Expanse 采用 Apache 2.0，无商业限制，无用户量门槛。这一点比 Llama 3.2 更友好，对于中型企业的私有化部署场景尤其重要。国内已有团队开始测试将 Aya Expanse 作为内部知识库 QA 的底座模型，替代现有的 GPT-4o 调用。',
      ],
    },
    {
      title: 'AI 工具替代了哪些"第一个小时"工作',
      subtitle: '调研 500 名开发者：启动、搜索、草拟——消失的三类工作',
      source: '少数派',
      url: 'https://example.com/14',
      snippet: '调研 500 名开发者的工作流，AI 替代了启动、搜索、草拟三类...',
      readingTime: '3 分钟',
      paragraphs: [
        '少数派发布了一项针对 500 名开发者的工作流调研，重点关注"每天工作开始后的第一个小时"里，AI 工具已经替代了哪些此前需要人工完成的步骤。调研结论令人印象深刻：超过 70% 的受访者表示，他们的"启动仪式"已经面目全非。',
        '被替代最彻底的是"冷启动搜索"——即开始一个新任务前，花时间搜集相关文档、看 StackOverflow、读 README 的过程。74% 的受访者表示，他们现在直接向 AI 提问，而非搜索引擎。这一变化对 Google 和 Stack Overflow 的流量影响已经在数据上有所体现。',
        '"草拟"类工作的替代率也很高：PR 描述、commit message、技术方案文档的初稿，86% 的受访者表示"通常让 AI 先写一版"。但有趣的是，78% 的人表示他们会对 AI 草稿进行"大幅修改"，只有 12% 表示"基本直接用"。这说明 AI 在这一场景里更多是"激活器"而非"替代者"。',
        '"启动"类工作（搭脚手架、配置环境、写 boilerplate）的替代率高达 91%，但也是受访者反馈"最容易出错、最需要验证"的类别。多位受访者提到，AI 生成的脚手架代码在表面上看起来完整，但往往在边界情况下有隐藏 bug，"看上去正确比看上去错误更危险"。',
      ],
    },
  ],

  // ── 第 1 期 · 2026-06-14 ──
  [
    {
      title: 'DeepMind AlphaFold 3 新数据集开放',
      subtitle: '蛋白质 + 小分子联合结构，8000 个复合物数据免费可用',
      source: 'DeepMind Blog',
      url: 'https://example.com/15',
      snippet: '蛋白质 + 小分子联合结构预测数据集，覆盖 8000+ 复合物...',
      readingTime: '3 分钟',
      paragraphs: [
        'DeepMind 宣布开放 AlphaFold 3 的配套数据集，包含超过 8000 个蛋白质-小分子复合物的结构预测结果，覆盖临床在研靶点的约 12%。这是继 AlphaFold 2 蛋白质数据库之后，DeepMind 在结构生物学领域最大规模的公开数据集发布。',
        '与 AF2 纯蛋白质结构不同，AF3 数据集的核心价值在于"联合结构"——同时预测蛋白质和与之结合的小分子配体的空间构象。这对药物发现中的"hit identification"阶段意义重大：研究人员可以在不进行昂贵湿实验的情况下，筛选出与靶蛋白结合姿势合理的候选分子。',
        '数据集采用 CC BY 4.0 许可，学术和商业用途均免费。多家生物技术公司已在第一时间接入，将这些结构数据整合进自己的虚拟筛选管线。业内分析师认为，这一开放数据集的发布将使初创药企的早期筛选成本降低 30-50%，进一步压缩了大型药企在计算生物学上的传统优势。',
      ],
    },
    {
      title: 'Mistral Large 2 发布：128K 上下文',
      subtitle: '欧洲最强闭源模型更新，函数调用能力大幅改进',
      source: 'Mistral AI',
      url: 'https://example.com/16',
      snippet: '欧洲最强闭源模型更新，函数调用能力大幅改进...',
      readingTime: '2 分钟',
      paragraphs: [
        'Mistral AI 发布 Mistral Large 2，将上下文窗口从 32K 扩展到 128K tokens，并声称函数调用能力相较前版"大幅改进"。独立测评结果显示，Mistral Large 2 在函数调用的准确率上达到 GPT-4o 的约 92%，在某些并行调用场景下甚至表现更优。',
        '对于欧洲用户而言，Mistral 的最大优势一直是"数据主权"——模型部署在欧盟数据中心，符合 GDPR 要求，且提供私有化部署选项。Large 2 延续了这一路线，同时通过与 Azure 和 Google Cloud 的合作扩大了访问渠道，让欧洲监管环境下的企业有了更强的 GPT-4 替代选项。',
        '定价方面，Mistral Large 2 的 API 价格比 GPT-4o 低约 35%，在同等性能区间内具有明显的成本优势。对于欧洲市场的 SaaS 创业者，这是一个值得优先测试的选项——如果性能满足需求，单纯的价格和合规优势就足以支撑迁移决策。',
      ],
    },
  ],
];

/* ================================================================
 * ci_topic_photo02 — 摄影活动，第 2 期完整正文，第 1 期简讯
 * ================================================================ */

const PHOTO_PICKS_POOL: MockPick[][] = [
  // 第 2 期 · 2026-06-17
  [
    {
      title: '第十届北京国际摄影周征稿截止延期通知',
      subtitle: '主办方称"质量优先于数量"，全球投稿者迎来最后窗口',
      source: '摄影世界',
      url: 'https://example.com/p1',
      snippet: '主办方宣布截稿日期延至 7 月 15 日，面向全球摄影师开放投稿...',
      readingTime: '2 分钟',
      paragraphs: [
        '第十届北京国际摄影周主办方中国摄影家协会昨日正式发布公告，将原定 6 月 30 日的投稿截止日期延至 7 月 15 日。公告措辞称此次延期旨在"给更多优秀作品留出申请时间"，但业内人士普遍认为，这与本届参赛作品数量未达历届水平直接相关。',
        '本届摄影周设置"城市记忆"与"自然共生"两个主题单元，向全球开放。奖项方面，金、银、铜奖各设一名，附带不超过 5 万元人民币的奖金，并提供北京主会场的展览机会。相比历届，本届新增了"手机摄影"专项单元，这一设定进一步模糊了摄影"工具门槛"的边界，在社区内引发了关于"摄影本质"的例行讨论。',
        '对于海外投稿者而言，延期提供了重要窗口。往届数据显示，海外作品在入选率上略低于国内，主要差距在于"主题理解的在地性"。本届评委团中有两位在国际摄影圈有影响力的评委，社区普遍认为这是主办方提升国际化水准的信号。',
      ],
    },
    {
      title: 'PhotoShanghai 2026 参展艺术家公布',
      subtitle: '28 国 120 人汇聚，"城市与自然"的张力成为本届主线',
      source: '艺术中国',
      url: 'https://example.com/p2',
      snippet: '今年聚焦「城市与自然」主题，来自 28 国的 120 位摄影师参与...',
      readingTime: '3 分钟',
      paragraphs: [
        'PhotoShanghai 2026 正式公布参展名单，共 120 位艺术家来自 28 个国家，将于 9 月 5-8 日在上海西岸艺术中心举行。本届主题"城市与自然"延续了近年来摄影圈对"生态危机的图像叙事"的持续关注，但策展人 Jing Wei 在接受媒体采访时强调，希望规避"说教性"，转而呈现"对峙中的美学张力"。',
        '入选名单中，华人艺术家占比约 35%，其中本土创作者 22 位，海外华人 20 位。值得注意的是，本届入选了三位 AI 辅助创作的摄影师——这是 PhotoShanghai 历史上首次公开接受"AI 协同"作为创作方法，策展委员会在公告中明确要求参展作者说明 AI 工具在创作流程中的具体角色。',
        '票务方面，公众开放日（9 月 7-8 日）的门票定价 180 元/天，较 2024 年上涨约 20%。VIP 开幕预览（9 月 5-6 日）仍采用邀请制，主要面向藏家和媒体。艺博会历来是上海秋季艺术季的重要节点，周边酒店和机票已出现明显涨幅，建议有意参观者尽早安排行程。',
      ],
    },
  ],
  // 第 1 期 · 2026-06-10（简讯，paragraphs 为空）
  [
    {
      title: 'PHOTOFAIRS Shanghai 2026 开幕在即',
      subtitle: '新兴亚洲影像创作者登场，画廊名单首度公开',
      source: '艺术圈',
      url: 'https://example.com/p3',
      snippet: '展会聚焦新兴亚洲影像创作者，将于 6 月 20 日开幕...',
      paragraphs: [],
    },
  ],
];

export const MOCK_REPORTS: MockReport[] = [
  // ci_topic_ai001：5 份（6/14-6/18，issueNumber 倒序：5=最新）
  { id: 'ci_report_001', topicId: 'ci_topic_ai001', date: '2026-06-18T08:00:00Z', picks: AI_PICKS_POOL[0], issueNumber: 5, headline: 'Claude 4.7、Codex 接班人与 Agent 框架战场' },
  { id: 'ci_report_002', topicId: 'ci_topic_ai001', date: '2026-06-17T08:00:00Z', picks: AI_PICKS_POOL[1], issueNumber: 4, headline: 'Gemini 实时视频 + 批量 API 成本评测' },
  { id: 'ci_report_003', topicId: 'ci_topic_ai001', date: '2026-06-16T08:00:00Z', picks: AI_PICKS_POOL[2], issueNumber: 3, headline: 'Cursor 1.0 正式发布：从辅助到 Agent 范式' },
  { id: 'ci_report_004', topicId: 'ci_topic_ai001', date: '2026-06-15T08:00:00Z', picks: AI_PICKS_POOL[3], issueNumber: 2, headline: '上下文管理策略与推理模型降价潮' },
  { id: 'ci_report_005', topicId: 'ci_topic_ai001', date: '2026-06-14T08:00:00Z', picks: AI_PICKS_POOL[4], issueNumber: 1 },
  // ci_topic_photo02：2 份
  { id: 'ci_report_p01', topicId: 'ci_topic_photo02', date: '2026-06-17T09:00:00Z', picks: PHOTO_PICKS_POOL[0], issueNumber: 2, headline: '北京摄影周延期 + PhotoShanghai 艺术家公布' },
  { id: 'ci_report_p02', topicId: 'ci_topic_photo02', date: '2026-06-10T09:00:00Z', picks: PHOTO_PICKS_POOL[1], issueNumber: 1 },
  // ci_topic_writing：暂无（空态）
];
