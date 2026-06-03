/**
 * ToolCatalog — 工具元数据中心(给人看的中文名 + 一句话用途)。
 *
 * 设计:
 *   后端代码常量、单一真相源。工具的实际能力定义在各 *.tool.ts 里(给模型看的英文
 *   description / zod schema),这里只承担「给 UI 显示」的人话翻译。
 *
 * 为什么不进 Mongo:
 *   工具中文名是工程师管的、随代码版本变化的;管理员不会去 UI 调"web_search
 *   翻译成什么"。按项目「配置归属准则」,代码同源 + GET 只读暴露即可,不必
 *   再做一张可编辑表,避免双写纪律。
 *
 * 加新工具时:
 *   在 tool.assembler 里挂工具的同时,在这里补一行元数据。
 *   UI fallback 行为:找不到 slug → 直接显 slug(老数据/未登记的工具不破)。
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md
 */

export interface ToolMeta {
  /** UI chip 主标签(中文) */
  displayName: string;
  /** chip 副标 / popover 说明(一句话用途) */
  description: string;
}

export const TOOL_CATALOG: Record<string, ToolMeta> = {
  // ── 知识库(已发布内容)── 全局可用
  search_knowledge_base: {
    displayName: '搜知识库',
    description: '按关键词在已发布内容里检索',
  },
  list_knowledge_base: {
    displayName: '列知识库',
    description: '列出已发布内容的目录树',
  },
  read_document_content: {
    displayName: '读已发布文档',
    description: '读取已发布文档正文(只读)',
  },

  // ── 当前草稿(写作场景)──
  get_current_draft: {
    displayName: '读当前草稿',
    description: '读取用户正编辑的草稿(文稿/画廊清单)',
  },
  propose_document_rewrite: {
    displayName: '提议改稿',
    description: '给当前文稿提议整段替换',
  },
  read_collection_entry: {
    displayName: '读文集条目',
    description: '读同一文集内的其他子篇',
  },

  // ── 画廊(图说场景)──
  view_photos: {
    displayName: '看图',
    description: '视觉模型读取画廊照片',
  },
  propose_caption: {
    displayName: '提议图说',
    description: '给画廊照片提议文字说明',
  },

  // ── 记忆(岁月史书架构)──
  remember: {
    displayName: '记忆觉察',
    description: '聊后批量写新观察到记忆',
  },
  recall_memory: {
    displayName: '回忆',
    description: '按标题/时间检索旧观察',
  },
  search_memories: {
    displayName: '检索记忆',
    description: '全文搜索历史观察',
  },

  // ── 协作 / 计划 / 回溯 ──
  sub_agent: {
    displayName: '委派子 agent',
    description: '委派独立子 agent 执行明确任务',
  },
  write_tasks: {
    displayName: '写任务清单',
    description: '整体改写当前写作计划清单',
  },
  read_conversation_history: {
    displayName: '回溯对话',
    description: '回溯本次对话用户的原话',
  },

  // ── 联网 ──
  web_search: {
    displayName: '联网搜索',
    description: '搜网页(需配 Tavily key)',
  },
  web_fetch: {
    displayName: '抓网页',
    description: '抓取指定 URL 转 markdown',
  },

  // ── 技能(本次新增,Phase 1)──
  Skill: {
    displayName: '调技能',
    description: '加载某个技能的完整方法论',
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
