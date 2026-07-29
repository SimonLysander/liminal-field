/**
 * 工具 description 集中表 —— 短描述统一在此一个 ts 引出（而非每个工具一个 md）。
 * 单一真源:各工具工厂(*.tool.ts)的 description 只留占位,组装层(tool.assembler)
 * 按工具名套用这里的文本。改工具描述只动本文件、走 git。
 * 注:长文提示词(system prompt / skill body)仍走 prompts/**.md 由 PromptManager 加载;
 *     这里只收"小段、多条"的工具描述。
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  browse: `扫订阅信箱,并行拉全部(或指定)订阅源在 since/until 窗口内的条目。不传 sourceIds 默认扫当前事项订阅的所有源;since/until 是本期收集窗口(ISO 8601 字符串),由 system prompt 给出,务必传;keywords 可选:传【正则】数组按主题精筛(OR——命中任一即留),对所有源的标题+摘要本地匹配、不区分大小写;英文加词边界 \\bword\\b 防误中(\\bagent\\b 不会误中 agentic),中文用交替 大模型|智能体。已历史去重(剔除本期 findings 已收录的)。返回 items 含 ref(i1, i2...)、title、url、publishedAt、snippet。搜索具体关键词找全网历史时,改用 web_search。`,

  list_knowledge_base: `列出所有者知识库内容的目录(标题、范围、文件夹路径、id;最新已提交,不论是否发布),不含正文。用于了解"库里到底有哪些内容"。要读全文用 contentItemId 调 read_document_content;要按关键词找用 search_knowledge_base。`,

  load_skill: `load_skill:加载一个已注册的技能(方法论)。传 name(slug)即可,系统会把对应的方法论正文注入对话作为下一步行动指引。只在 <available_skills> 列出的 name 才可用,未列出的不要尝试。`,

  pick: `标记这些 item 为本任务的相关 findings。一次调用挑一批，每条带为啥挑的理由。所有挑出来的 findings 会作为 agent 工作的最终产物。`,

  propose_caption: `为某张照片提议图说(caption):传 fileName + caption(可选 reason)。**这是提议、不自动生效**——作者在卡片上点「应用」才写入照片;所以调用后说「我提议了『…』,满意就点应用」,他点应用前别称「已改好/已保存」。**硬上限 30 字**,超出工具拒。`,

  read_collection_entry: `读取当前文集里另一个子节点的当前内容(最新已提交,不论是否发布)。编辑本节点时用它参考同集其它节点——做衔接、避免重复、保持风格一致。节点 id 取自 <collection> 列表。当前正在编辑的这篇用 get_current_draft,不要用本工具。`,

  read_content: `读取一个笔记节点当前有效的真实内容：有用户正在编辑的草稿时只返回草稿（即使草稿为空）；没有草稿才返回最新已提交正文（不要求已对外发布）。两者绝不同时返回。都没有就返回"该节点暂无内容"。不返回 Aurora 自己写的 AI 初稿（那是产出、不是源材料，读回给自己无意义）。只读不写。planner 和 writer 均可调用。`,

  read_conversation_history: `读取当前对话的完整历史原文(可按关键词过滤),用于精确回溯之前聊过/问过什么。session 记忆是有损精炼时，用此工具还原原话。`,

  read_document_content: `读取知识库里一篇内容的正文(最新已提交版本,不论是否发布)。返回大纲(全)+ 从 offset 起的一段正文(默认约 6000 字)。文档很长时返回会带"还有更多",用 offset 续读。当前正在编辑的这篇用 get_current_draft。`,

  recall_memory: `按 topic 深读所有者的最近观察(按时间倒序)。想看某个维度的具体观察轨迹时调这条;想找跨主题的关键词相关观察用 search_memories。topic 必填,5 选 1:identity(身份) / personality(性格) / aesthetic(审美) / method(方法) / other(兜底)。`,

  remember: `remember:批量记下值得长期保留的觉察(append-only 岁月史书,只增不改不删)。

每条由两块组成,合起来像史书的一条:

- topic 必填,5 选 1:
    identity     身份(职业 / 教育 / 居住 / 语言文化)
    personality  性格(性格特质 / 价值观 / 思维倾向 / 当下心境)
    aesthetic    审美(觉得什么好 / 美 / 对的跨场景品味判断)
    method       方法(怎么做事 / 思维模型 / 流程 / 节奏 / 工具)
    other        兜底,谨慎用

- context 可选,≤ 300 字,**详写背景**——那段对话聊什么、TA 做了什么动作 / 选择、TA 怎么解释自己的选择、张力反差。
  让未来的你看到 context 就能复原现场,理解 observation 的判断从何而来。
  ✅ "改一段技术笔记时,他先连删三条 inline 注释,其中一条是别人为他写的清晰解释,说'反而像替我念';段间总结也划掉,但保留了一个'TODO 这里有个坑'的警示——删的是解释,留的是警示。"
  ❌ "聊代码风格时"(没信息量,等于没说)

- observation 必填,≤ 120 字,**简短判断/取向**(类似太史公曰):
  ✅ "代码注释偏极简——删解释留警示。冗余像替读者念词。"
  ✅ "学新概念偏造最小例子再看定义,费曼式'造而后悟'。"
  ❌ 复述 context 里的事实(observation 是判断,不是事实)
  ❌ 长篇大论(超 120 字说明 context 没写够,把细节挪回 context)

何时调:用户暴露**新长期信号**时(新事 / 新观点 / 新偏好 / 新身份)。
何时不调:寒暄 / 纯工具调用 / 重复信号 / 不确定。**宁少勿滥**。

一句话暴露多面信号(身份 + 审美 + 方法)→ 拆成多条 observation,各管一面 topic。

调完**不要**在回复里 acknowledge("我记下了"),继续自然对话——塑形是潜意识动作。

超字数 / 非法 topic → 整批 reject + invalid 回执,需重写。`,

  search_knowledge_base: `按关键词搜索所有者知识库内容(笔记、相册、文集;最新已提交版本,不论是否发布),返回命中标题、范围、时间和片段。要读全文用返回的 contentItemId 调 read_document_content;要看"库里有哪些"用 list_knowledge_base。`,

  search_memories: `关键词模糊搜跨主题的所有者观察(matches observation 字段 + context 字段)。想找跟具体话题/事物相关的观察轨迹时用这条;想看某个 topic 的所有最近观察用 recall_memory。可选 topic 过滤;截断时 meta 给 hasMore + nextOffset,可用 offset 续取。`,

  sub_agent: `把研究焦点委派给独立的只读研究 agent。它会自动获得当前用户请求、近期对话、会话摘要和业务场景，并可检索知识库、读取当前学习内容、联网搜索及深读网页；task 用于明确本轮研究重心，不必重复全部背景。适合需要多来源检索、交叉查证或综合分析的任务。`,

  view_photos: `查看若干照片的画面本身(传 fileName 数组)。调用后这些照片会出现在你接下来能看到的内容里,据此写图说。只传你确实要看的,别一次全要。`,

  web_fetch: `读取一个 URL 的全文(markdown 形式)。默认 auto:服务器直抓 → Firecrawl → Jina Reader,成功结果会短期缓存。用于深读外部文章——用户贴 url、或 web_search 后需要读具体页面全文。只在写作或回答真需要深读外部页面时用。长文会被截断(默认 30000 字符)。失败时返回 status/kind/attempts 等事实。`,

  web_search: `联网搜索。需要验证事实/查引用/找外部信息时调用(用户问外部知识、写作要找资料、验年代/人名/书名等)。返回多条 url + 摘要片段,可直接在回答中引用 url。只在写作或回答真需要外部依据时用。`,

  write_draft: `把研究成果写成当前笔记节点的 AI 初稿（aidraft），供用户只读参考。只写当前这一篇，目标节点已由系统固定，无法改变。每次都给 changeSummary，简明说明这次改了什么及其取舍；缺它会被退回。

首次起草、重构主线或标题层级时，用 replace_document（默认）提交一篇完整 Markdown。只重写已有的一节时，用 replace_section：sectionPath 给从 H1 到目标标题的完整路径，sectionMarkdown 只给该标题下的新正文，不重复标题；其中只能有更低级子标题。局部重写依赖同一会话里已经生成的完整初稿和来源表；不确定当前初稿结构时不要猜，改用整篇重写。局部模式仍须传整篇完整 sources（无来源传 []）；已有来源保持内容、顺序和序号，新来源追加在末尾。新正文含 CIT 时才提交该小节的 citationAudit。

公式使用 KaTeX。行内公式写作 $…$；公式块必须写成由独占行的起止 $$ 包围的三行结构，不得写成单行 $$公式$$。公式块用于需要单独阅读的核心等式、推导或复杂表达式，短表达式作为句子的一部分时仍使用行内公式。

出处:本篇主线依赖的概念与定义、归属与演进、数据与状态、规则与证据必须先查证并在句末标 [@#CIT N];N 对应 sources 第 N 条。sources 只填真实读到过的 title/url。整篇写入有 sources 时提交 citationAudit，按四类列出已查证断言及 sources 序号；某类没有可传空数组。推理过程、类比、写作组织、个人理解、日常生活常识不标；很深入但不支撑主线的高深旁支应删减或概括，不逐条追深奥细节。纯推演文章可以没有 sources；有 sources 但缺 citationAudit、标了 CIT 但 sources 不足都会被退回。`,

  write_learn_plan: `把学习规划的「概要 + 三段开篇 + 篇目脉络 + 收束」写入当前主题的 AI 草稿区，供所有者在左栏对照重写。初次规划不要求作者已有正文。goal 只概括方向；understanding 恰好写三个自然段，依次完成主题界定、作者目标和组织主线；items 逐篇展开学习作用与次序理由；conclusion 在节点线后综合路径并回扣目标，不复述篇名或开篇。工具只落库，不建任何节点、不改作者正文。调用时**必须同时给出 changeSummary**，供审批卡展示：首次生成时扼要说明总篇与篇目如何组织；重做已有规划时说明重排、增删或调整了什么及原因。缺它会被退回。`,

  write_tasks: `改写当前会话的写作计划清单(整体替换:给出**完整**列表覆盖原清单)。用于规划、增删、调整顺序、标记进度。当前清单已在 system prompt 的 <tasks> 中。
纪律(逼你想清楚,别偷懒):① 每个任务都必须给 status;② **同一时刻只能有一个 in_progress**(你当前正在做的那个),其余是 pending 或 done;③ 用列表顺序表达先后,不需要依赖字段;④ 每推进一步就调用本工具更新,让计划始终反映真实进度;⑤ **全部做完、或计划作废时,传空列表 \`[]\` 清空**(否则这份计划会一直留在你的上下文里);⑥ 给这份计划起个简短的 title(如「研究排序笔记」「重构开篇」),显示在计划区头部。`,
};
