/**
 * ToolCatalog — 工具说明书(给管理员看的中文版)。
 *
 * 真相职责分工:
 *   - 每个 *.tool.ts 的 description / inputSchema 给 LLM 看,语气和长度为模型理解优化
 *   - 本文件是给管理员看的中文版,精简、贴合实际行为,加新工具时同步补一条
 *
 * 字段:
 *   - displayName  chip 上显示的短名(空间小,不要超 6 字)
 *   - summary      chip 副标 / popover 一行说明(不超 25 字)
 *   - detail       工具页展开后的段落(2-4 句,讲清楚做什么 + 什么时候用 + 限制)
 *   - params[]     输入参数(从 inputSchema 抽,中文翻译;按声明顺序)
 *   - returns      返回结果格式说明(一两句)
 *
 * 找不到的 slug:前端 fallback 显原 slug,不破老数据/新工具尚未登记的过渡态。
 */

export interface ToolParam {
  /** 参数名,跟 zod schema 一致(可能是嵌套路径,如 'observations[].topic') */
  name: string;
  /** 类型摘要,人话格式 — 如 'string'、'string[]'、'number (默认 5)'、'enum' */
  type: string;
  required: boolean;
  /** 一句话说明这个参数是什么 */
  description: string;
}

export interface ToolMeta {
  displayName: string;
  summary: string;
  detail: string;
  params: ToolParam[];
  returns: string;
}

export const TOOL_CATALOG: Record<string, ToolMeta> = {
  // ── 知识库(已发布内容)── 全局可用
  search_knowledge_base: {
    displayName: '搜知识库',
    summary: '按关键词在已发布内容里检索',
    detail: '关键词模糊匹配标题 + 正文,返回命中的 contentItem 摘要列表。',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: '关键词,自然语言或关键词均可',
      },
      {
        name: 'scope',
        type: 'enum: notes / gallery / anthology',
        required: false,
        description: '限定范围(笔记 / 画廊 / 文集),不传 = 全部',
      },
      {
        name: 'limit',
        type: 'number (默认 10)',
        required: false,
        description: '返回上限',
      },
    ],
    returns: '命中数组:每项含 contentItemId、标题、摘要;按相关度排序',
  },

  list_knowledge_base: {
    displayName: '列知识库',
    summary: '列出已发布内容目录(分页)',
    detail:
      '不带条件返回所有已发布内容,支持 scope 限定和 offset / limit 翻页,跟 search_knowledge_base 互补(那个按内容找,这个按目录列)。',
    params: [
      {
        name: 'scope',
        type: 'enum: notes / gallery / anthology',
        required: false,
        description: '限定范围,不传 = 全部',
      },
      {
        name: 'limit',
        type: 'number (默认 50)',
        required: false,
        description: '本页条数',
      },
      {
        name: 'offset',
        type: 'number (默认 0)',
        required: false,
        description: '从第几条起,翻页用',
      },
    ],
    returns: '条目数组 + nextOffset(无更多时为 null)',
  },

  read_document_content: {
    displayName: '读已发布文档',
    summary: '按 ID 读已发布文档正文(分段)',
    detail:
      '只读已发布的成稿;当前正在编辑的草稿走 get_current_draft。一次最多读 6000 字,超长用 nextOffset 续读。',
    params: [
      {
        name: 'contentItemId',
        type: 'string',
        required: true,
        description: '从 search / list 结果里拿的 contentItem ID',
      },
      {
        name: 'offset',
        type: 'number (默认 0)',
        required: false,
        description: '从第几个字符起读',
      },
      {
        name: 'limit',
        type: 'number (默认 6000)',
        required: false,
        description: '本次最多读多少字符',
      },
    ],
    returns: '段正文 + nextOffset(指向下一段起点;读完则为 null)',
  },

  // ── 当前草稿 / 改稿 / 文集 ──
  get_current_draft: {
    displayName: '读当前草稿',
    summary: '读用户正编辑的草稿(随场景变体)',
    detail:
      '场景化:写作场景返回文稿头部 + 大纲 + 字数 + 段落 + 正文 + meta.bodyHash(后续改稿用);画廊场景返回照片清单 + 随笔。改稿必须先调它拿 bodyHash 再调 propose_document_rewrite。',
    params: [
      {
        name: 'offset',
        type: 'number (默认 0)',
        required: false,
        description: '从第几个字符起读(画廊场景忽略)',
      },
      {
        name: 'limit',
        type: 'number (默认 6000)',
        required: false,
        description: '本次最多读多少字符(画廊场景忽略)',
      },
    ],
    returns:
      '文稿场景:头部 + 大纲 + 字数 + 段落 + 正文 + meta.bodyHash;画廊场景:照片清单 + 随笔',
  },

  propose_document_rewrite: {
    displayName: '提议改稿',
    summary: '给当前文稿提议整段替换',
    detail:
      '不直接改文件,落到前端 diff suggestion,由用户逐 hunk 批准。bodyHash 必填且必须等于上次 get_current_draft 返回的值,否则后端拒绝(防 stale 改稿)。',
    params: [
      {
        name: 'newMarkdown',
        type: 'string',
        required: true,
        description: '完整新版正文(markdown 全文,不是 patch)',
      },
      {
        name: 'reason',
        type: 'string',
        required: true,
        description: '为什么这样改,让用户看懂动机',
      },
      {
        name: 'bodyHash',
        type: 'string',
        required: true,
        description: '上次 get_current_draft 返回的 meta.bodyHash',
      },
    ],
    returns: '前端收到 propose-edit 事件;hash 不匹配 → 拒绝 + 提示重读草稿',
  },

  read_collection_entry: {
    displayName: '读文集条目',
    summary: '读同一文集的其他子篇',
    detail:
      '只在文集子节点场景下挂载。从 system prompt 的 <collection> 上下文取 nodeId,读同一文集内其他子篇正文,做集合级理解 / 风格对照。',
    params: [
      {
        name: 'nodeId',
        type: 'string',
        required: true,
        description: '目标子节点 id,见 <collection> 列表',
      },
    ],
    returns: '该子节点的正文 + 元信息',
  },

  // ── 画廊(图说场景)──
  view_photos: {
    displayName: '看图',
    summary: '视觉模型读取画廊照片',
    detail:
      '注入指定照片的多模态内容给视觉模型;只在画廊场景挂载,且 agent 必须配 visionProviderId 才有用。',
    params: [
      {
        name: 'fileNames',
        type: 'string[]',
        required: true,
        description: '要看的照片 fileName 列表(从 get_current_draft 取)',
      },
    ],
    returns: '视觉模型的 multimodal content(图片内容注入到下轮 LLM 调用)',
  },

  propose_caption: {
    displayName: '提议图说',
    summary: '给画廊照片提议文字说明',
    detail:
      '不直接写,落到前端待人工 approve。一次只提议一张,reason 可选(让用户看懂为什么这样写)。',
    params: [
      {
        name: 'fileName',
        type: 'string',
        required: true,
        description: '目标照片 fileName',
      },
      {
        name: 'caption',
        type: 'string',
        required: true,
        description: '提议的图说文案',
      },
      {
        name: 'reason',
        type: 'string',
        required: false,
        description: '为什么这样写,可选',
      },
    ],
    returns: '前端收到 propose-caption 事件,显示在该照片的待批区',
  },

  // ── 记忆(岁月史书架构)──
  remember: {
    displayName: '记忆觉察',
    summary: '聊后批量写新观察到岁月史书',
    detail:
      'Append-only,只增不改不删;agent 在对话现场主动判断"该不该记"。每条 observation(≤120 字简短判断)+ context(≤300 字背景),按 topic 分类。整批字数 / topic 非法 → 全部拒绝并返每条错误,要求重写。',
    params: [
      {
        name: 'observations',
        type: 'array (1-10 条)',
        required: true,
        description: '本次批量写入的观察列表',
      },
      {
        name: 'observations[].topic',
        type: 'enum: identity / personality / aesthetic / method / other',
        required: true,
        description: '身份 / 性格 / 审美 / 方法 / 兜底,5 选 1',
      },
      {
        name: 'observations[].observation',
        type: 'string (≤120 字)',
        required: true,
        description: '简短判断或取向,类似太史公曰,不是复述事实',
      },
      {
        name: 'observations[].context',
        type: 'string (≤300 字)',
        required: false,
        description: '背景:聊什么、做了什么、怎么解释',
      },
    ],
    returns: '成功 → 写入条数;有任一违反字数 / 枚举 → 整批拒绝并返每条错误',
  },

  recall_memory: {
    displayName: '回忆',
    summary: '按 topic 取观察(时间倒序)',
    detail:
      '按 5 类 topic 之一返回该类下最近 N 条观察。常用于 agent 在对话开始时主动拉相关侧面,比 search_memories 直接。',
    params: [
      {
        name: 'topic',
        type: 'enum: identity / personality / aesthetic / method / other',
        required: true,
        description: '从 <memories_index> 上下文里精确选一个',
      },
      {
        name: 'limit',
        type: 'number (默认 20,上限 50)',
        required: false,
        description: '单次返回条数',
      },
    ],
    returns: '该 topic 下的 observation 列表 + context(若有),按写入时间倒序',
  },

  search_memories: {
    displayName: '检索记忆',
    summary: '全文搜历史观察(含分页)',
    detail:
      'case-insensitive 模糊匹配 observation + context;query 传空串则按时间倒序返全部。支持 topic 限定 + offset 续取。',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: '关键词;传空串 = 不过滤,按时间倒序',
      },
      {
        name: 'topic',
        type: 'enum: identity / personality / aesthetic / method / other',
        required: false,
        description: '限定某类下搜,不传 = 全部',
      },
      {
        name: 'limit',
        type: 'number (默认 20,上限 50)',
        required: false,
        description: '单页条数',
      },
      {
        name: 'offset',
        type: 'number (默认 0)',
        required: false,
        description: '续取偏移(用上页返回的 nextOffset)',
      },
    ],
    returns: '命中数组 + meta.nextOffset(无更多时为 null)',
  },

  // ── 协作 / 计划 / 回溯 ──
  sub_agent: {
    displayName: '委派子 agent',
    summary: '委派独立子 agent 跑明确子任务',
    detail:
      '主 agent 自己想清楚要做什么 → 拆出具体子任务委派,子 agent 独立 context + 只读工具集,完成后返报告。适合"先搜 N 篇再综合"这类多步骤但跟主话题分得开的活,避免污染主对话历史。',
    params: [
      {
        name: 'task',
        type: 'string',
        required: true,
        description: '明确、可完成的任务描述(自然语言)',
      },
      {
        name: 'title',
        type: 'string (几个字)',
        required: true,
        description: '短标题,显示在 Delegate 行,如「分析量子计算笔记」',
      },
      {
        name: 'max_steps',
        type: 'number (默认 12)',
        required: false,
        description: '子 agent 最大推理步数',
      },
    ],
    returns: '子 agent 的最终报告(文本);用尽 max_steps 则截断 + 标注',
  },

  write_tasks: {
    displayName: '写任务清单',
    summary: '整体改写当前写作计划',
    detail:
      'TodoWrite 式:每次调用整体覆盖任务列表,不是增量。同一时刻只能有一个 in_progress。计划落在草稿级 agent 实例上,业务会话切换不清空。',
    params: [
      {
        name: 'title',
        type: 'string',
        required: false,
        description: '计划标题,几个字概括,显示在计划区头部',
      },
      {
        name: 'tasks',
        type: 'array',
        required: true,
        description: '完整任务列表,按先后顺序排列(整体覆盖式)',
      },
      {
        name: 'tasks[].title',
        type: 'string',
        required: true,
        description: '单条任务标题',
      },
      {
        name: 'tasks[].status',
        type: 'enum: pending / in_progress / done',
        required: true,
        description: '状态;同一时刻最多一个 in_progress',
      },
    ],
    returns: '前端计划区刷新成新列表',
  },

  read_conversation_history: {
    displayName: '回溯对话',
    summary: '回溯本次会话用户的原话',
    detail:
      'session 记忆是有损精炼后的;要查"用户当时具体怎么说的"必须用这个工具拿原文。仅在有 sessionKey 的对话场景挂载。',
    params: [
      {
        name: 'keyword',
        type: 'string',
        required: false,
        description: '可选关键词过滤;不传 = 取最近 N 条',
      },
      {
        name: 'limit',
        type: 'number (默认 50)',
        required: false,
        description: '返回上限;过滤后超出取最近 N 条',
      },
    ],
    returns: '历史消息数组(原文,含 user / assistant / tool)',
  },

  // ── 联网 ──
  web_search: {
    displayName: '联网搜索',
    summary: '搜网页(需配 Tavily key)',
    detail:
      'AI 优化的网页搜索 API。未配 TAVILY_API_KEY 时本工具不挂载,模型看不到 → 自然不会调(优雅降级)。',
    params: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: '搜索 query,关键词为主,不必造句',
      },
      {
        name: 'maxResults',
        type: 'number (1-10,默认 5)',
        required: false,
        description: '本次最多返回多少条',
      },
      {
        name: 'topic',
        type: 'enum: general / news (默认 general)',
        required: false,
        description: 'general 通用 / news 偏新闻类',
      },
    ],
    returns: '结果列表:每项 {title, url, content}',
  },

  web_fetch: {
    displayName: '抓网页',
    summary: '抓 URL 转 markdown(Jina Reader)',
    detail:
      '用 Jina Reader 免 key 抓取并清洗为 markdown,适合读 web_search 命中的具体页面。',
    params: [
      {
        name: 'url',
        type: 'string',
        required: true,
        description: '完整 http(s) URL',
      },
      {
        name: 'maxLength',
        type: 'number (500-100000,默认 30000)',
        required: false,
        description: '本次最多返回多少字符',
      },
    ],
    returns: '页面的 markdown 化全文(可能截断)',
  },

  // ── 技能(Phase 1 新增)──
  Skill: {
    displayName: '调技能',
    summary: '加载某个技能的方法论全文',
    detail:
      'Agent 在 system prompt 看到 <available_skills> 后,需要调起某个 skill 时调用本工具,工具返回 skill body(完整方法论)注入到对话上下文。三层校验:skill 存在 + agent 启用 + 必需工具齐备。',
    params: [
      {
        name: 'name',
        type: 'string',
        required: true,
        description:
          'Skill 的 slug(如 critic、polisher),从 <available_skills> 取',
      },
    ],
    returns: 'skill body 全文(注入到下轮);任一层校验失败 → 拒绝 + 原因',
  },
};

/** UI 友好的列表形态,带上 slug 自己,前端拉一次就够。 */
export interface ToolCatalogEntry extends ToolMeta {
  name: string;
}

export function listToolCatalog(): ToolCatalogEntry[] {
  return Object.entries(TOOL_CATALOG).map(([name, meta]) => ({
    name,
    ...meta,
  }));
}
