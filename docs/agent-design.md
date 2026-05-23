# AI Agent 底座设计

> 状态：设计中 | 创建：2026-05-20

---

## 目标

为 Liminal Field 构建一个 AI Agent 底座：

- **当前需求**：Notes 编辑器内的写作顾问——帮用户理清思路、检查逻辑、回答领域问题，绝不代写
- **架构目标**：通用的 agent 基础设施（harness + tools + memory），未来可接入任何入口（管理端、展示端、API）

## 设计原则

1. **Agent 有能力，不只是有上下文**——通过工具系统主动查询内容系统，而不是被动接收上下文
2. **入口和能力解耦**——工具注册是全局的，入口只负责注入自己特有的上下文
3. **Tool call 对用户透明**——用户能看到 agent 正在调用什么工具、拿到了什么
4. **LLM 可替换**——所有国内主流提供商都兼容 OpenAI chat completions 格式，一套客户端通吃

---

## 架构总览

```
┌─ 入口层（Entry Points）────────────────────────────────────────┐
│                                                                 │
│  Notes 编辑器左侧面板        管理端对话页        展示端阅读助手    │
│  （第一期）                  （未来）            （未来）          │
│                                                                 │
│  每个入口提供：                                                   │
│  · entryContext（当前文档、选区等）                                │
│  · 入口特有的工具（get_current_document 等）                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        │  统一消息协议（HTTP SSE）
                        │
                        ▼
┌─ Harness 编排层 ──────────────────────────────────────────────┐
│                                                                │
│  1. 加载 persistent memory                                     │
│  2. 组装 system prompt（角色 + 约束 + 记忆 + 入口上下文）         │
│  3. 注册工具集（全局工具 + 入口工具）                              │
│  4. ReAct 循环：                                                │
│     LLM 调用 → tool_call? → 执行工具 → 结果喂回 → 再调用         │
│                → text?     → 流式输出给前端                      │
│  5. 循环结束后：                                                 │
│     检查 memory 工具是否被调用，持久化新记忆                       │
│                                                                │
└──────┬──────────────┬──────────────┬───────────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌─ 工具系统 ──┐  ┌─ 记忆系统 ──┐  ┌─ LLM 客户端 ─────────────┐
│              │  │              │  │                           │
│  内容工具     │  │  会话记忆     │  │  OpenAI 兼容 HTTP client  │
│  · search    │  │  （前端管理） │  │  · streaming              │
│  · read      │  │              │  │  · tool calling           │
│  · list      │  │  持久记忆     │  │  · 可配置 provider        │
│  · navigate  │  │  （MongoDB）  │  │                           │
│              │  │              │  │  DeepSeek / 通义 / 智谱    │
│  编辑器工具   │  │  记忆工具     │  │  / Moonshot / ...         │
│  · document  │  │  · save      │  │                           │
│  · selection │  │  · recall    │  │                           │
└──────────────┘  └──────────────┘  └───────────────────────────┘
```

---

## 1. Harness 编排层

Harness 是 agent 的执行引擎，实现标准 ReAct 循环。

### 执行流程

```
POST /api/v1/agent/chat
  │
  ▼
解析请求
  │  messages: ChatMessage[]
  │  entryContext: { source, document?, selectedText? }
  │  sessionId: string
  │
  ▼
加载持久记忆
  │  从 MongoDB 读全量 AgentMemory
  │  （个人系统，记忆量级 ~百条，全量加载可行）
  │
  ▼
组装 system prompt
  │  = 角色定义
  │  + 行为约束
  │  + 持久记忆摘要
  │  + 入口上下文（当前文档、选区）
  │  + 自定义 system prompt（如果 settings 有配置）
  │
  ▼
注册工具集
  │  = 全局工具（search_content, read_content, list_items, get_navigation）
  │  + 记忆工具（save_memory, recall_memories）
  │  + 入口工具（由 entryContext.source 决定）
  │
  ▼
┌─ ReAct 循环 ──────────────────────────────────┐
│                                                │
│  调用 LLM（streaming, tools=[...]）             │
│    │                                           │
│    ├── tool_calls →                            │
│    │     发射 SSE event: tool_call              │
│    │     执行工具                               │
│    │     发射 SSE event: tool_result            │
│    │     追加到 messages                        │
│    │     → 回到循环顶部                         │
│    │                                           │
│    └── text content →                          │
│          发射 SSE event: delta（逐 chunk）       │
│          → 结束循环                             │
│                                                │
│  安全阀：最多 10 轮 tool call，防止死循环          │
│                                                │
└────────────────────────────────────────────────┘
  │
  ▼
发射 SSE event: done
```

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 会话历史谁管理 | 前端 | 无状态后端更简单；前端每次请求发全量 messages |
| 持久记忆何时加载 | 每次请求开头 | 量级小，全量加载无性能问题 |
| 上下文超长怎么办 | 截断文档，保留选区+前后段 | 大多数笔记 <5000 字不需要截断 |
| 最大 tool call 轮数 | 10 | 防止 LLM 陷入工具调用循环 |

---

## 2. 工具系统

### 工具接口

```typescript
interface AgentTool {
  /** 工具名，LLM function calling 用 */
  name: string;
  /** 给 LLM 看的描述，影响 LLM 何时选用这个工具 */
  description: string;
  /** JSON Schema，定义参数 */
  parameters: Record<string, unknown>;
  /** 执行工具，返回文本结果给 LLM */
  execute(args: Record<string, unknown>): Promise<string>;
}
```

### 工具注册

```typescript
@Injectable()
class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void;
  registerMany(tools: AgentTool[]): void;
  get(name: string): AgentTool | undefined;
  /** 转换为 OpenAI function calling 格式 */
  toFunctionDefs(): FunctionDef[];
}
```

模块启动时注册全局工具，harness 执行时按 entry source 补充入口工具。

### 全局工具清单

#### `search_content` — 搜索知识库

复用已有的 `ContentService.searchContents()`，支持标题 + 正文全文搜索。

```
参数：
  query: string          — 搜索关键词
  scope?: string         — 限定范围：notes / gallery / anthology，不传搜全部
  limit?: number         — 返回数量上限，默认 5

返回：
  匹配结果列表，每条包含 contentItemId、title、scope、匹配摘要
```

**设计说明**：现有搜索基于 MongoDB `$regex`，对个人知识库的规模（百 ~ 千篇）足够。
未来如果需要语义搜索，可以加一个 `semantic_search` 工具，不影响现有工具。

#### `read_content` — 读取一篇内容

复用 `ContentService.getContentById()` + 各 ViewService 的详情方法。

```
参数：
  contentItemId: string  — 内容 ID
  scope?: string         — notes / gallery / anthology，帮助选择正确的 ViewService 解析

返回：
  标题、正文（bodyMarkdown）、元数据（日期、标签等）
  anthology 额外返回条目列表（标题 + 摘要，不含全文）
```

#### `read_anthology_entry` — 读取文集条目

复用 `AnthologyViewService.getEntryDetail()`。

```
参数：
  contentItemId: string  — 文集 ID
  entryKey: string       — 条目 key

返回：
  标题、正文（bodyMarkdown）、日期
```

#### `list_items` — 列出内容列表

复用 `NavigationNodeService.listStructureNodes()`。

```
参数：
  scope: string          — notes / gallery / anthology
  parentId?: string      — 文件夹 ID，不传列根级

返回：
  节点列表（id、name、type:FOLDER|DOC、contentItemId）
```

#### `get_navigation` — 获取导航结构

复用 `NavigationNodeService.listStructureNodes()`，递归展开。

```
参数：
  scope: string          — notes / gallery / anthology

返回：
  树形导航结构（文件夹嵌套、文档叶子节点）
```

### 记忆工具

#### `save_memory` — 保存持久记忆

Agent 主动调用，将值得记住的信息持久化。

```
参数：
  content: string        — 记忆内容（如"用户擅长数学但不熟悉物理"）
  category?: string      — 分类标签（如 user_preference / domain_knowledge / writing_pattern）

行为：
  写入 MongoDB AgentMemory 集合
```

#### `recall_memories` — 检索记忆

```
参数：
  query?: string         — 搜索关键词，不传返回全部

返回：
  匹配的记忆列表（content + category + createdAt）
```

**设计说明**：第一期用全量加载 + system prompt 注入，`recall_memories` 工具做为
显式搜索的补充手段。如果记忆量增长到影响 token 消耗，再引入向量检索。

### 入口工具（Notes 编辑器）

这两个工具不调用后端服务——它们的数据由前端随请求提交，harness 直接从 entryContext 读取。

#### `get_current_document` — 获取当前编辑的文档

```
返回：
  title: string
  bodyMarkdown: string
  contentItemId: string
  wordCount: number
```

#### `get_selected_text` — 获取当前选区

```
返回：
  selectedText: string     — 选中的文字，空字符串表示无选区
  surroundingContext: string — 选区前后各 ~200 字，帮助 LLM 理解上下文
```

**设计说明**：这两个工具的数据来自前端，不是服务端主动读取。
前端每次请求在 `entryContext` 中携带最新的文档内容和选区，harness 包装成工具结果。
这样 LLM 可以决定是否需要看文档（而不是每次都塞进 system prompt）。

但考虑到写作顾问场景下 LLM 几乎总是需要看文档，我们也在 system prompt 中
注入一份精简版（标题 + 字数 + 前 500 字摘要），让 LLM 知道文档的存在。
LLM 需要看全文时再调用 `get_current_document`。

---

## 3. 记忆系统

### 会话记忆

**存储位置**：前端 React state
**生命周期**：当前编辑会话内（切换文档或关闭编辑器即清空）
**内容**：完整的 messages 数组（user + assistant + tool_call + tool_result）

前端每次请求发送完整 messages，后端无状态。

### 持久记忆

**存储位置**：MongoDB `agent_memories` 集合

```typescript
class AgentMemory {
  _id: ObjectId;
  content: string;           // 记忆内容
  category: string;          // 分类：user_preference / domain_knowledge / writing_pattern / general
  createdAt: Date;
  updatedAt: Date;
}
```

**写入方式**：agent 通过 `save_memory` 工具主动保存
**读取方式**：harness 每次请求时全量加载，注入 system prompt

**System prompt 中的记忆注入格式**：

```
<memories>
以下是你从历次对话中记住的信息：
- [user_preference] 用户擅长数学，不熟悉物理，解释物理概念时需要更详细
- [writing_pattern] 用户习惯先列大纲再填充内容
- [domain_knowledge] 用户正在研究分布式系统，最近在写 Raft 相关的笔记
</memories>
```

**记忆的有效管理**：
- agent 的 system prompt 中包含指引："当你发现新的重要信息时，调用 save_memory 记住它"
- 也包含："如果已有的记忆过时了，调用 save_memory 更新它（相同 category 的旧记忆会被覆盖？）"
- 第一期先不做自动去重/更新，靠 agent 的判断力
- 如果记忆过多（>50 条），截断最老的

---

## 4. 上下文工程

### System Prompt 结构

```
┌─ 角色定义 ──────────────────────────────────────────┐
│  你是一位写作顾问...（见"Agent 人格"节）              │
└─────────────────────────────────────────────────────┘
┌─ 持久记忆 ──────────────────────────────────────────┐
│  <memories>                                          │
│  - [category] content                                │
│  - ...                                               │
│  </memories>                                         │
└─────────────────────────────────────────────────────┘
┌─ 入口上下文摘要 ────────────────────────────────────┐
│  <current-document-summary>                          │
│  标题：XXX                                           │
│  字数：1234                                          │
│  摘要（前 500 字）：...                               │
│  （调用 get_current_document 工具可获取全文）          │
│  </current-document-summary>                         │
│                                                      │
│  <selected-text>（如果有选区）                        │
│  用户当前选中了以下文字：...                           │
│  </selected-text>                                    │
└─────────────────────────────────────────────────────┘
┌─ 用户自定义补充（settings 可配）──────────────────────┐
│  （可选）用户写的额外指令                              │
└─────────────────────────────────────────────────────┘
```

### Token 预算管理

以 DeepSeek-V3（64K context）为例：

| 部分 | 估算 token |
|------|-----------|
| System prompt（角色 + 约束） | ~500 |
| 持久记忆（50 条） | ~2000 |
| 文档摘要（500 字） | ~800 |
| 工具定义（6 个） | ~1500 |
| 预留给对话历史 | ~20000 |
| 预留给工具调用结果 | ~10000 |
| 预留给 LLM 输出 | ~4000 |
| **合计** | **~39000** |

余量充足。即使文档全文 5000 字（~8000 token），也在预算内。

### 超长文档策略

当文档超过 10000 字时：
1. System prompt 中只放摘要（标题 + 前 500 字 + 目录结构）
2. `get_current_document` 工具返回全文
3. 如果全文 + 历史仍超限，对历史消息做滑动窗口裁剪（保留最近 N 轮）

---

## 5. Agent 人格与约束

### 默认 System Prompt

```
你是 Liminal Field 的写作顾问。用户正在编辑文章，你能看到文档内容，也能搜索用户的知识库。

你的职责：
1. 回答用户关于写作的问题——结构、逻辑、措辞、组织方式
2. 在用户不确定时，帮忙理清思路，提供几种可能的写法方向
3. 检查内容的逻辑一致性和事实准确性（基于你的知识）
4. 当用户提到陌生领域时，给出准确的解释和参考方向
5. 如果用户的其他笔记中有相关内容，主动搜索并关联

你的约束：
- 绝不代替用户写作。不要输出成品段落让用户复制粘贴
- 给建议时简洁直接，不要教科书式的长篇大论
- 如果发现值得长期记住的信息（用户的写作偏好、领域知识背景），调用 save_memory 保存
- 工具调用要有明确目的，不要为了展示能力而滥用工具
```

### Settings 可配置

用户可在设置页覆盖/补充 system prompt，比如：
- "我是一名软件工程师，主要写技术笔记"
- "给建议时用中文"
- "我的写作风格偏简洁"

---

## 6. LLM 客户端

### 接口

```typescript
interface LLMClientConfig {
  baseUrl: string;     // e.g., https://api.deepseek.com
  apiKey: string;
  model: string;       // e.g., deepseek-chat
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;       // tool name, when role='tool'
}

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LLMClient {
  /**
   * 流式调用 LLM。
   * 返回 AsyncGenerator，yield 两种类型：
   * - { type: 'delta', content: string }    — 文本片段
   * - { type: 'tool_call', id, name, args } — 工具调用请求
   */
  chat(
    messages: ChatMessage[],
    tools?: ToolDef[],
  ): AsyncGenerator<LLMChunk>;
}
```

### Provider 兼容性

所有主流国内 LLM 提供商都兼容 OpenAI chat completions 格式：

| 提供商 | baseUrl | 支持 function calling | 支持 streaming |
|--------|---------|---------------------|----------------|
| DeepSeek | `https://api.deepseek.com` | Yes | Yes |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode` | Yes | Yes |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas` | Yes | Yes |
| Moonshot | `https://api.moonshot.cn` | Yes | Yes |
| 百川 | `https://api.baichuan-ai.com` | Yes | Yes |

一套 `LLMClient` 实现，用户在 settings 里配 baseUrl + apiKey + model 即可切换。

---

## 7. API 协议

### 请求

```
POST /api/v1/agent/chat
Content-Type: application/json
Accept: text/event-stream
```

```typescript
interface AgentChatRequest {
  /** 对话消息历史（前端管理） */
  messages: ChatMessage[];

  /** 入口上下文 */
  entryContext: {
    /** 来源标识，决定注入哪些入口工具 */
    source: 'notes-editor' | 'admin-panel' | 'reader';

    /** 当前文档（notes-editor 入口） */
    document?: {
      contentItemId: string;
      title: string;
      bodyMarkdown: string;
    };

    /** 当前选区（notes-editor 入口） */
    selectedText?: string;
  };
}
```

### 响应（SSE）

```
event: tool_call
data: {"id":"call_1","name":"search_content","args":{"query":"量子纠缠"}}

event: tool_result
data: {"id":"call_1","name":"search_content","result":"找到 3 篇相关笔记：..."}

event: delta
data: {"content":"你这段关于"}

event: delta
data: {"content":"量子纠缠的描述基本准确，"}

event: error
data: {"message":"LLM 调用失败"}

event: done
data: {}
```

前端通过 SSE event type 区分：
- `tool_call` → 显示 "正在搜索知识库..." 等工具调用指示
- `tool_result` → 可选：展示工具返回的摘要
- `delta` → 逐字渲染 assistant 回复
- `error` → 显示错误
- `done` → 请求结束

---

## 8. 前端入口：Notes 编辑器左侧面板

### 布局改造

当前编辑器左侧是一个空的 spacer div：

```jsx
{/* 改造前 */}
<div className="shrink-0" style={{ width: 'var(--layout-sidebar)' }} />
```

改造为可展开的 AI 面板：

```jsx
{/* 改造后 */}
{aiPanelOpen ? (
  <AiAdvisorPanel
    contentItemId={...}
    document={...}
    selectedText={...}
    onClose={() => setAiPanelOpen(false)}
  />
) : (
  <div className="shrink-0" style={{ width: 'var(--layout-sidebar)' }}>
    <AiPanelTrigger onClick={() => setAiPanelOpen(true)} />
  </div>
)}
```

### 面板宽度

- 收起时：`var(--layout-sidebar)`（~168-200px），只显示一个触发按钮
- 展开时：`clamp(20rem, 25vw, 28rem)`（~320-448px），足够显示对话内容
- 展开时编辑器区域自动缩窄（flex 布局自适应）

### 面板结构

```
AiAdvisorPanel
├── PanelHeader
│   ├── 标题 "写作顾问"
│   └── 关闭按钮
│
├── MessageList（滚动区域）
│   ├── AssistantMessage     ← markdown 渲染
│   │   └── ToolCallCard     ← "搜索知识库: 量子纠缠" + 展开/收起结果
│   ├── UserMessage
│   └── ...
│
├── SelectionHint（如果有选中文字）
│   └── "已选中 42 字" + 预览
│
└── ChatInput
    ├── textarea（自适应高度）
    └── 发送按钮（Enter 发送，Shift+Enter 换行）
```

### 核心 Hook

```typescript
function useAiChat(entryContext: EntryContext) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);

  async function send(userMessage: string) {
    // 1. 追加 user message 到列表
    // 2. POST /api/v1/agent/chat（SSE）
    // 3. 消费 SSE 事件：
    //    - tool_call → setActiveToolCall("正在搜索知识库...")
    //    - tool_result → 追加 ToolCallCard 到当前 assistant message
    //    - delta → 追加文字到当前 assistant message
    //    - done → setIsStreaming(false)
  }

  function clear() { setMessages([]); }

  return { messages, isStreaming, activeToolCall, send, clear };
}
```

### 编辑器选区感知

通过 Plate 的 `useEditorSelection` 获取当前选区文本。
选区变化时更新 `SelectionHint` 组件的显示。
发送消息时，当前选区文本随 `entryContext.selectedText` 一起提交。

---

## 9. Settings 配置

### MongoDB 扩展

复用现有 `SystemConfig` 文档，新增 AI 分区字段：

```typescript
// system-config.model.ts 新增字段
aiBaseUrl?: string;       // LLM API 地址
aiApiKey?: string;        // API 密钥（脱敏存储）
aiModel?: string;         // 模型名称
aiSystemPrompt?: string;  // 用户自定义 system prompt 补充
```

### SystemConfigService 扩展

```typescript
async saveAiConfig(input: {
  aiBaseUrl: string;
  aiApiKey?: string;
  aiModel: string;
  aiSystemPrompt?: string;
}): Promise<void>;
```

### SettingsConfigView 扩展

```typescript
ai: {
  aiBaseUrl: string;
  hasAiApiKey: boolean;    // 脱敏，不暴露原文
  aiModel: string;
  aiSystemPrompt: string;
};
```

### 前端 Settings 页

在现有设置页增加 "AI 配置" 分区：
- API 地址（text input，placeholder: "https://api.deepseek.com"）
- API 密钥（password input）
- 模型名称（text input，placeholder: "deepseek-chat"）
- 自定义指令（textarea，placeholder 显示默认的角色描述供参考）

---

## 10. 代码结构

### 后端

```
server/src/modules/agent/
├── agent.module.ts                  ← NestJS 模块注册
├── agent.controller.ts              ← POST /api/v1/agent/chat（SSE）
├── agent-harness.service.ts         ← ReAct 编排循环
├── llm-client.service.ts            ← OpenAI 兼容 streaming client
├── tool-registry.service.ts         ← 工具注册表
├── prompt-builder.service.ts        ← system prompt 组装
├── tools/
│   ├── tool.interface.ts            ← AgentTool 接口定义
│   ├── search-content.tool.ts       ← 搜索知识库
│   ├── read-content.tool.ts         ← 读取单篇内容
│   ├── read-anthology-entry.tool.ts ← 读取文集条目
│   ├── list-items.tool.ts           ← 列出内容列表
│   └── get-navigation.tool.ts       ← 获取导航结构
├── memory/
│   ├── agent-memory.model.ts        ← TypeGoose model
│   ├── agent-memory.repository.ts   ← MongoDB CRUD
│   ├── save-memory.tool.ts          ← save_memory 工具
│   └── recall-memories.tool.ts      ← recall_memories 工具
└── dto/
    ├── agent-chat.dto.ts            ← 请求/响应类型
    └── entry-context.dto.ts         ← 入口上下文类型
```

### 前端

```
client/src/components/ai-advisor/
├── AiAdvisorPanel.tsx               ← 主面板组件
├── PanelHeader.tsx                  ← 标题 + 关闭
├── MessageList.tsx                  ← 消息列表（滚动）
├── ChatMessage.tsx                  ← 单条消息（user / assistant）
├── ToolCallCard.tsx                 ← 工具调用展示卡片
├── SelectionHint.tsx                ← 选区提示
├── ChatInput.tsx                    ← 输入框
└── useAiChat.ts                     ← 状态管理 + SSE 消费
```

### Settings 扩展

```
server/src/modules/settings/
  system-config.model.ts             ← 新增 ai* 字段
  system-config.service.ts           ← 新增 saveAiConfig / getAiConfig
  settings.controller.ts             ← 新增 AI 配置端点

client/src/pages/admin/settings/
  SettingsPage.tsx                   ← 新增 AI 配置分区
```

---

## 11. 实施计划

### 第一期：底座 + Notes 入口

**后端**（按依赖顺序）：

1. `tool.interface.ts` — 定义 AgentTool 接口
2. `tool-registry.service.ts` — 工具注册表
3. `llm-client.service.ts` — OpenAI 兼容 streaming client
4. `agent-memory.model.ts` + `agent-memory.repository.ts` — 持久记忆存储
5. `save-memory.tool.ts` + `recall-memories.tool.ts` — 记忆工具
6. `search-content.tool.ts` + `read-content.tool.ts` — 内容工具（复用现有 service）
7. `prompt-builder.service.ts` — system prompt 组装
8. `agent-harness.service.ts` — ReAct 循环
9. `agent.controller.ts` — SSE 端点
10. `agent.module.ts` — 模块注册
11. Settings 扩展（model + service + controller）

**前端**（按依赖顺序）：

1. Settings 页 AI 配置分区
2. `useAiChat.ts` — SSE 消费 + 状态管理
3. `ChatMessage.tsx` + `ToolCallCard.tsx` — 消息渲染
4. `ChatInput.tsx` — 输入区
5. `AiAdvisorPanel.tsx` — 面板组装
6. `DraftEditPage.tsx` — 集成面板到编辑器左侧

### 第二期：扩展（按需）

- 更多工具：`list_items`、`get_navigation`、`read_anthology_entry`
- 管理端独立对话入口
- 记忆管理 UI（查看/删除持久记忆）
- Token 用量统计
- 多轮 tool call 的 UI 优化（折叠、进度条）
