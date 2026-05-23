# Liminal Field 内容平台演进设计

> 状态：设计中 | 创建：2026-05-20

---

## 1. 愿景

Liminal Field 是一个个人内容管理系统。当前已经建好了**版本+发布系统**这个基座。下一步是在此基础上，逐层构建更高阶的能力——先让人能高效地组织、检索、关联自己的内容，然后再引入 AI Agent 作为新的交互方式来复用这些能力。

核心思路：**人先能用好，agent 只是换了个入口调用同样的东西。**

---

## 2. 现状：基座层

### 已完成

```
┌─ 版本 + 发布 ───────────────────────────────────────┐
│                                                      │
│  ContentItem          指针容器，latestVersion /       │
│                       publishedVersion 指向 snapshot  │
│                                                      │
│  ContentSnapshot      版本快照，bodyMarkdown 不透明存储 │
│                       fileName 支持多文件（文集条目）   │
│                                                      │
│  EditorDraft          独立草稿，不影响版本链            │
│                                                      │
│  NavigationNode       导航树，scope 隔离              │
│                       (notes / gallery / anthology)   │
│                                                      │
│  Git 异步归档          推送 + 恢复 + 清单文件           │
│                                                      │
│  三个 ViewService      文件协议解析 + DTO 构造          │
│  (Notes/Gallery/       bodyMarkdown ↔ 结构化数据       │
│   Anthology)                                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 缺什么

基座只解决了"内容怎么存、怎么改、怎么发布"。但以下能力是缺失的：

- **找不到东西** — 没有可用的搜索（后端有一个 regex 实现，但前端没有入口，且 regex 搜索质量差）
- **内容是孤岛** — 笔记之间没有关联，无法知道"这篇和哪篇有关"，也无法追踪引用的书籍、论文等外部资料

---

## 3. 架构分层

```
┌────────────────────────────────────────────────────┐
│                   Agent 层                          │
│                                                    │
│  写作顾问 / 知识问答 / 内容分析                      │
│  tools = 上层能力的薄封装                            │
│  人能做的事，agent 也能做；agent 做不了额外的事        │
│                                                    │
│  前提：上层能力足够完善，agent 才有东西可调用           │
├────────────────────────────────────────────────────┤
│                   上层能力                          │
│                                                    │
│  搜索 → 引用与关联                                   │
│                                                    │
│  每个能力：后端 Service + API + 前端 UI               │
│  人能直接用，有完整的交互体验                         │
│                                                    │
│  这一层是当前的建设重点                               │
├────────────────────────────────────────────────────┤
│                   基座层                            │
│                                                    │
│  版本系统 + 发布体系 + 导航树 + Git 归档              │
│  三 scope ViewService + 文件协议                     │
│                                                    │
│  已完成，稳定运行                                    │
└────────────────────────────────────────────────────┘
```

---

## 4. 上层能力设计

按优先级排列。每个能力包含：人怎么用、技术方案、agent 怎么复用。

### 4.1 全文搜索

**为什么排第一**：找不到东西是最基本的痛点。所有后续能力（关联、推荐、agent 搜索工具）都依赖搜索。

#### 人怎么用

- 管理端顶部：全局搜索框（⌘K 唤起）
- 展示端：搜索入口
- 输入关键词 → 实时返回匹配结果（标题 + 正文片段高亮）
- 支持按 scope 筛选（全部 / notes / gallery / anthology）
- 搜索结果可直接点击跳转

#### 技术方案

**现状问题**：`ContentService.searchContents()` 用 MongoDB `$regex` 做全文匹配。问题：
- 无分词，中文搜"分布式"不会匹配到"分布 式系统"
- 无相关性排序
- 无高亮片段提取
- 性能随数据量线性下降

**方案选择**：

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| MongoDB Atlas Search | 全托管，支持中文分词，相关性排序 | 需要 Atlas 或 MongoDB 7.0+ | 云部署 |
| MongoDB $text index | 内置，零部署成本 | 中文分词弱，需要第三方分词 | 快速起步 |
| MeiliSearch | 优秀的中文支持，毫秒级响应，轻量 | 多一个服务，需同步数据 | 追求搜索质量 |
| 应用层优化 regex | 零改动 | 搜索质量差 | 不做 |

**推荐**：个人系统数据量小（百 ~ 千篇），先用 **MongoDB text index** 快速落地，搜索体验不够再换 MeiliSearch。

**实现要点**：
1. `ContentSnapshot` 增加 text index（`bodyMarkdown` + 关联 `ContentItem.title`）
2. 新建 `SearchService`，封装搜索逻辑（分页、高亮片段提取、scope 过滤）
3. 搜索结果 DTO：`{ contentItemId, title, scope, snippet, score }`
4. 前端：`⌘K` 命令面板组件（参考 cmdk / kbar）

#### Agent 复用

```typescript
// agent tool: 直接调用 SearchService
class SearchContentTool implements AgentTool {
  name = 'search_content';
  async execute({ query, scope, limit }) {
    return this.searchService.search(query, { scope, limit });
  }
}
```

---

### 4.2 引用与关联

**为什么排第二**：内容之间的连接是知识管理的核心。两个维度——引用外部资料（书、论文、网页）和关联自己的笔记。

#### 两种引用

| | 内部链接 | 外部引用 |
|--|---------|---------|
| 指向 | 自己的另一篇笔记 | 书 / 论文 / 网页 / 文件 / 课程 |
| 例子 | 参见我的 Raft 笔记 | 参考《DDIA》 |
| 存在哪 | contentItemId | 引用库（Reference） |
| 怎么建立 | 编辑器 `[[` 搜索笔记 | 文档参考列表里添加 |

**粒度决策**：文档级参考列表，不做句级/段级引用标注。正文中需要标注出处时，直接用 blockquote + 手写归属（`> ... — 《DDIA》第 5 章`），这是写作行为，不是系统功能。

#### 4.2.1 引用库（Reference Library）

极简的外部资料集合，没有版本、没有发布、没有草稿。

**数据模型**：

```typescript
class Reference {
  _id: ObjectId;
  title: string;            // 《DDIA》
  type: string;             // book / paper / url / file / course
  author?: string;          // Martin Kleppmann
  url?: string;             // 网页链接 / 文件地址
  note?: string;            // 一句话备注
  createdAt: Date;
  updatedAt: Date;
}
```

**人怎么用**：

- 管理端：引用库列表页，可浏览、搜索、新建、编辑
- 按 type 分组或筛选（书、论文、网页...）
- 点击某条引用 → 看到所有引用了它的笔记（反向查询）

**API**：
- `GET /references` — 列表（支持 type 筛选、关键词搜索）
- `POST /references` — 新建
- `PATCH /references/:id` — 编辑
- `DELETE /references/:id` — 删除
- `GET /references/:id/cited-by` — 哪些笔记引用了这条

#### 4.2.2 文档参考列表

每篇文档可以关联多条引用（内部笔记 + 外部引用），存在独立集合。

**数据模型**：

```typescript
class ContentReference {
  _id: ObjectId;
  contentItemId: string;       // 哪篇笔记
  targetType: 'content' | 'reference';  // 指向内部笔记 or 外部引用
  targetId: string;            // contentItemId 或 referenceId
  createdAt: Date;
}
```

**人怎么用**：

- 编辑器 / 管理端详情页：文档底部「参考」区域
- 添加引用：搜索框同时搜内部笔记和引用库，选择后添加
- 引用库里没有？直接快速新建一条引用再关联
- 参考列表显示：标题 + 类型图标 + 可点击（内部笔记跳转，外部链接打开）

#### 4.2.3 内部链接（编辑器 `[[`）

在正文中快速链接到另一篇笔记。和参考列表是两种交互方式，共享同一套关联基础设施。

**编辑器集成**：
- Plate 编辑器新增 `WikiLinkPlugin`，输入 `[[` 触发 combobox（复用 InlineCombobox 组件）
- 搜索文档标题，选择后插入 `[[文档标题]]`
- 渲染为可点击链接
- 提交版本时，从 bodyMarkdown 中提取 `[[...]]`，自动同步到 `ContentReference`

**反向链接查询**：
```typescript
// 查找所有关联到 targetId 的文档（不管是通过参考列表还是 [[ 链接）
contentReferenceModel.find({ targetId, targetType: 'content' })
```

**展示**：
- 编辑器右侧大纲面板下方：反向链接列表（"被以下文档引用"）
- 阅读页底部：相关笔记

#### Agent 复用

```typescript
class FindRelatedTool implements AgentTool {
  name = 'find_related';
  async execute({ contentItemId }) {
    const refs = await this.refService.getReferences(contentItemId);
    const citedBy = await this.refService.getCitedBy(contentItemId);
    return { references: refs, citedBy };
  }
}
```

Agent 可以回答："这篇笔记参考了哪些资料？""哪些笔记引用了《DDIA》？"

---

## 5. Agent 层设计

Agent 层在上层能力之上，提供**对话式交互**这一种新的入口。

### 5.1 定位

```
上层能力提供的：                Agent 增加的：
✓ 搜索框能搜                   · 自然语言提问（"我写过关于 X 的东西吗"）
✓ 参考列表能看引用             · 跨能力组合（搜索 + 读取 + 关联，一次对话完成）
✓ 反向链接能看                 · 写作建议（"这段逻辑通吗"）
                               · 领域知识补充（"帮我解释这个概念"）
                               · 持久记忆（记住用户偏好和背景）
```

**Agent 不创造新能力，它组合已有能力 + 加上 LLM 的推理。**

### 5.2 架构

```
┌─ 入口 ───────────────────────────────────────────┐
│  Notes 编辑器左侧面板（第一期）                     │
│  管理端独立对话页（未来）                           │
│  展示端阅读助手（未来）                             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─ Harness 编排 ───────────────────────────────────┐
│                                                   │
│  1. 加载持久记忆                                   │
│  2. 组装 system prompt                            │
│     · 角色定义 + 约束                              │
│     · 持久记忆                                     │
│     · 入口上下文（当前文档摘要、选区）               │
│     · 用户自定义补充指令                            │
│  3. 注册工具集                                     │
│     · 全局工具：search, read, find_related          │
│     · 记忆工具：save_memory, recall_memories       │
│     · 入口工具：get_current_document, get_selection │
│  4. ReAct 循环                                    │
│     LLM → tool_call → 执行 → 结果 → LLM → ...    │
│         → text → 流式输出                          │
│  5. 安全阀：最多 10 轮 tool call                   │
│                                                   │
└──────┬──────────┬──────────┬─────────────────────┘
       │          │          │
       ▼          ▼          ▼
   上层能力     记忆系统    LLM 客户端
   Services    MongoDB    OpenAI 兼容
```

### 5.3 工具清单

| 工具 | 来源 | 能力层 |
|------|------|--------|
| `search_content` | SearchService | 全文搜索 |
| `read_content` | ContentService + ViewService | 基座 |
| `find_related` | ContentReferenceService | 引用与关联 |
| `save_memory` | AgentMemoryRepository | Agent 专属 |
| `recall_memories` | AgentMemoryRepository | Agent 专属 |
| `get_current_document` | 前端 entryContext | 入口注入 |
| `get_selected_text` | 前端 entryContext | 入口注入 |

除了记忆工具和入口工具，**其他工具全部是对已有 Service 的薄封装**。

### 5.4 记忆系统

**会话记忆**：前端 React state，每次请求发送完整消息历史。

**持久记忆**：MongoDB `agent_memories` 集合，agent 通过 `save_memory` 工具主动保存。

```typescript
class AgentMemory {
  content: string;      // "用户擅长数学但不熟悉物理"
  category: string;     // user_preference / domain_knowledge / writing_pattern
  createdAt: Date;
  updatedAt: Date;
}
```

每次请求时全量加载（个人系统记忆量级小），注入 system prompt。

### 5.5 Agent 人格

```
你是 Liminal Field 的写作顾问。用户正在编辑文章，你能看到文档内容，
也能搜索用户的知识库、查看标签、查找关联文档。

你的职责：
- 帮用户理清写作思路，提供组织建议
- 检查内容逻辑和事实准确性
- 用户不确定时，给出几种可能的方向
- 主动搜索用户知识库中的相关内容，帮助关联
- 记住用户的写作偏好和知识背景

你的约束：
- 绝不代替用户写作
- 建议简洁直接
- 工具调用要有目的，不为展示能力
```

### 5.6 LLM 客户端

一套 OpenAI 兼容的 HTTP client，支持 streaming + tool calling。用户在 Settings 配置 `baseUrl + apiKey + model`，国内主流提供商（DeepSeek、通义、智谱、Moonshot）全部兼容。

### 5.7 API 协议

```
POST /api/v1/agent/chat
Accept: text/event-stream

Request: {
  messages: ChatMessage[],
  entryContext: {
    source: 'notes-editor',
    document?: { contentItemId, title, bodyMarkdown },
    selectedText?: string
  }
}

Response (SSE):
  event: tool_call   → { name, args }           // 前端显示 "正在搜索..."
  event: tool_result  → { name, summary }        // 前端显示工具结果摘要
  event: delta        → { content }              // 逐字输出
  event: done         → {}
```

### 5.8 前端入口：Notes 编辑器

改造编辑器左侧空 spacer 为可展开的 AI 对话面板：

- 收起时：`var(--layout-sidebar)` 宽度，一个触发按钮
- 展开时：`clamp(20rem, 25vw, 28rem)` 宽度
- 面板内容：消息列表 + 工具调用卡片 + 选区提示 + 输入框
- 工具调用透明：显示 "正在搜索知识库: 量子纠缠" 等状态

---

## 6. 前端 Settings：AI 配置

复用现有 `SystemConfigService`，新增 `ai` 分区：

- API 地址（baseUrl）
- API 密钥（apiKey，脱敏存储）
- 模型名称（model）
- 自定义指令（systemPrompt，可选补充）

---

## 7. 实施路线图

### Phase 1：全文搜索

**做什么**：
- MongoDB text index + SearchService
- 搜索 API（分页、高亮片段提取、scope 过滤）
- 管理端 ⌘K 搜索面板
- 展示端搜索入口

**交付物**：人能在管理端和展示端搜索全部内容。

### Phase 2：引用与关联

**做什么**：
- 引用库：`Reference` 集合 + CRUD API + 管理端列表页
- 文档参考列表：`ContentReference` 集合 + 文档详情页「参考」区域
- 内部链接：编辑器 `[[` 触发文档搜索（复用 InlineCombobox）+ 提交时自动提取
- 反向链接：API + 编辑器/阅读页展示

**交付物**：人能管理引用库、给文档添加参考、在正文中链接笔记、看到反向引用。

### Phase 3：Agent 底座

**做什么**：
- LLM Client（OpenAI 兼容 streaming）
- AgentTool 接口 + ToolRegistry
- Agent Harness（ReAct 循环）
- 持久记忆（MongoDB + save/recall 工具）
- 内容工具（封装 Phase 1-2 的 Service）
- SSE API 端点
- Settings AI 配置

**交付物**：Agent 后端完整可用。

### Phase 4：Notes 编辑器 AI 入口

**做什么**：
- AiAdvisorPanel 组件
- useAiChat hook（SSE 消费）
- 工具调用透明 UI
- 编辑器选区感知
- 编辑器左侧面板集成

**交付物**：在 Notes 编辑器中可以与 AI 写作顾问对话。

---

## 8. 关键设计原则

1. **人先于 agent** — 每个能力先做人用的 UI，agent 工具只是薄封装
2. **增量交付** — 每个 phase 独立可用，不依赖后续 phase
3. **不过度设计** — 个人系统，数据量小，先用最简方案（MongoDB text index > MeiliSearch > ES）
4. **复用基座** — 上层能力全部建立在现有 ContentService / NavigationService 之上，不另起炉灶
5. **LLM 可替换** — Agent 不绑定任何提供商，配置切换
6. **文档级引用** — 参考列表挂在文档上，不做句级/段级标注。正文中标注出处用 blockquote + 手写归属

---

## 9. 代码结构预览

### 上层能力

```
server/src/modules/search/
├── search.module.ts
├── search.service.ts              ← 全文搜索逻辑
├── search.controller.ts           ← GET /search
└── dto/search-result.dto.ts

server/src/modules/reference/
├── reference.module.ts
├── reference.model.ts             ← Reference 引用库条目
├── reference.service.ts           ← CRUD + 搜索
├── reference.controller.ts        ← GET/POST/PATCH/DELETE /references
├── content-reference.model.ts     ← ContentReference 文档-引用关联
├── content-reference.service.ts   ← 关联管理 + 反向查询 + [[ 提取
└── content-reference.controller.ts
```

### Agent 层

```
server/src/modules/agent/
├── agent.module.ts
├── agent.controller.ts            ← POST /agent/chat (SSE)
├── agent-harness.service.ts       ← ReAct 编排
├── llm-client.service.ts          ← OpenAI 兼容 streaming
├── tool-registry.service.ts       ← 工具注册
├── prompt-builder.service.ts      ← system prompt 组装
├── tools/
│   ├── tool.interface.ts
│   ├── search-content.tool.ts     ← → SearchService
│   ├── read-content.tool.ts       ← → ContentService
│   └── find-related.tool.ts       ← → ContentReferenceService
├── memory/
│   ├── agent-memory.model.ts
│   ├── agent-memory.repository.ts
│   ├── save-memory.tool.ts
│   └── recall-memories.tool.ts
└── dto/
    └── agent-chat.dto.ts

client/src/components/ai-advisor/
├── AiAdvisorPanel.tsx
├── ChatMessage.tsx
├── ToolCallCard.tsx
├── SelectionHint.tsx
├── ChatInput.tsx
└── useAiChat.ts
```

---

## 10. 依赖关系

```
Phase 1 (搜索)  ───┐
                    ├──→ Phase 3 (Agent 底座) ──→ Phase 4 (Notes AI 入口)
Phase 2 (引用)  ───┘
```

Phase 1 和 Phase 2 互相独立，可以按任意顺序或并行。
Phase 3 依赖 Phase 1-2 的 Service（但即使只做了 Phase 1 也能先上 agent，只是工具少）。
Phase 4 依赖 Phase 3。

**最小可行路径**：Phase 1 → Phase 3 → Phase 4（只有搜索工具的 agent，但能用）。
