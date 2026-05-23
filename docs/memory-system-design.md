# Agent 记忆系统设计

> 状态：设计中 | 创建：2026-05-21

---

## 为什么需要记忆系统

当前 agent 的两个根本缺陷：

1. **对话是一次性的** — 关掉页面对话就没了，用户回来 agent 不知道之前聊过什么
2. **记忆是平铺的** — 50 条记忆全量塞进 system prompt，大部分跟当前对话无关，浪费 token 且噪音大

目标：让 agent 像一个有记忆的协作者——记得你是谁、记得你的偏好、记得上次聊到哪了。

---

## 设计依据

综合调研了以下来源：

| 来源 | 核心思路 |
|------|---------|
| **Claude Code** | 文件式记忆（MEMORY.md 索引 + 独立 .md 文件），4 种类型（user/feedback/project/reference），ASSUME INTERRUPTION 原则 |
| **Anthropic Memory Tool** | Agent 通过 CRUD 工具自管理 /memories 目录，启动时先查记忆 |
| **Anthropic Context Engineering** | 三层协同：Tool Result Clearing + Compaction + Memory |
| **Letta/MemGPT** | OS 虚拟内存隐喻：Core Memory（始终在 context）/ Recall（可搜索）/ Archival（长期） |
| **Mem0** | 对话 → 原子事实提取管道，向量+图双存储 |
| **学术论文** | 三层认知模型（Working / Episodic / Semantic），巩固路径（episodic → semantic） |

---

## 三层记忆架构

用一句话解释每一层：

- **Working Memory**：当前对话中 AI 能"看到"的所有信息。就是 LLM 的 context window。
- **Episodic Memory**：对话记录的存档。用户关掉页面再回来，能看到之前的对话。
- **Semantic Memory**：从对话中提炼出来的认知。"这个用户是数据分析师"、"他不喜欢口水话"。

类比人的记忆：
- Working = 你现在脑子里想着的事
- Episodic = 你记得上周二跟他聊过什么（具体对话）
- Semantic = 你知道他是个什么样的人（提炼的认知）

### 三层的关系

```
Working Memory（当前对话的 context window）
  │
  │── 对话消息自动保存 ──→ Episodic（会话存档）
  │                          用户回来时恢复到 Working
  │
  │── agent 调工具写入 ──→ Semantic（持久记忆）
  │                          下次 session 开始时
  ←── 自动注入回 Working ──┘
```

- 用户发消息、AI 回复 → 消息在 Working Memory 里
- AI 回复完成 → 消息自动存到 Episodic（会话存档）
- AI 发现值得记住的事 → 调 write_memory 写入 Semantic
- 下次用户打开 → Episodic 恢复对话记录，Semantic 中的用户信息注入 system prompt

### 记忆系统往 System Prompt 注入什么

记忆系统只负责注入两块内容：

```
System Prompt
  ├── ... 业务层的东西（角色定义、文档上下文等，不归记忆系统管）
  │
  ├── Core Memories（type=user 的全部记忆，完整内容）
  │   始终注入，因为"用户是谁"跟每次对话都相关
  │
  └── Memory Index（type=project 的标题列表）
      只注入 key: title，agent 需要时调 read_memory 拿完整内容
```

---

## Working Memory

就是 LLM 的 context window。对话开始时，system prompt + 历史消息 + 注入的记忆一起构成 Working Memory。

**特点：** 有容量上限（LLM 的 context window 大小），对话越长越接近上限。

### Compaction（对话压缩 + 记忆巩固）

对话过长时，把旧消息压缩成摘要，只保留最近 N 轮完整消息。**同时从旧消息中提取值得记住的信息，写入 Semantic Memory。**

**两个参数：**
- **N = 8**（保留最近 8 轮完整消息）
- **T = 16**（总轮数达到 16 时触发）

**一轮 = 一对 user + assistant 消息。**

**触发时同时做两件事（一次 LLM 调用）：**

1. **Compact** — 把旧消息压缩成一段摘要，替换原始消息
2. **Extract** — 从旧消息中提取值得长期记住的 facts，自动写入 `agent_memories`

这就是 Episodic → Semantic 的巩固路径。不依赖 agent 主动调工具，系统级保证。

**流程：**

```
第 1-16 轮：正常聊，什么都不做

第 16 轮结束 → 触发：
  LLM 调用：输入第 1-8 轮消息
  输出：{ summary: "...", memories: [{ key, type, title, content }, ...] }
  
  → summary 替换第 1-8 轮消息
  → memories 自动 upsert 到 agent_memories
  → 保留：[Summary v1] + 第 9-16 轮

继续聊到第 24 轮 → 再次触发：
  LLM 调用：输入 [Summary v1] + 第 9-16 轮消息
  输出：{ summary: "...", memories: [...] }
  
  → [Summary v2] + 第 17-24 轮

以此类推...
```

**压缩提示词（给执行压缩的 LLM 调用）：**

```
请处理以下对话记录，输出两部分：

1. summary：将对话压缩为一段摘要（保留关键事实、决策、未解决的问题，丢弃寒暄和重复内容）

2. memories：提取值得长期记住的信息，每条包含：
   - key：唯一标识（英文，如 "user_writing_style"）
   - type："user"（关于用户本人）或 "project"（关于用户的事）
   - title：一行中文摘要
   - content：完整内容（中文）

   提取规则：
   - 只提取跨对话有价值的信息，不要提取当前对话的临时细节
   - 用户明确说的通用偏好 → type: user
     例："我所有文章都不要用成语"
   - 关于某件具体事的一切（进展、决策、偏好）→ type: project
     写进那件事的 project 记忆里，不要单独建条目
     例："这篇别用表格了" → 更新 project_quantum_article 的 content
   - 不确定是通用还是特定时，归 project（宁窄不泛，避免错误泛化）
```

---

## Episodic Memory（会话存档）

### 是什么

就是对话记录的存档。完整保存每一轮对话的原始消息，用户回来时原样恢复。

不是"记忆"，更像"聊天记录"。

### 数据模型

```
AgentSession {
  sessionKey  : string              // 唯一索引，调用方决定语义
  messages    : Record<string, unknown>[]  // 完整 UIMessage[]，透传存储
  lastActiveAt: Date
  createdAt   : Date
}
```

`sessionKey` 是不透明字符串——记忆系统不知道也不关心它代表什么。调用方决定语义：
- 编辑器传 `draft-{contentItemId}` → 每篇文档一个对话
- 未来其他入口可以传任意 key

### 生命周期

```
用户打开页面
  │
  ├─ 前端用 sessionKey 查后端：有历史对话？
  │   ├─ 有 → setMessages(历史消息)，恢复对话
  │   └─ 没有 → 空对话，显示问候语
  │
  ├─ 用户和 AI 对话...
  │
  ├─ 每轮 AI 回复完成后（status: streaming → ready）
  │   └─ 自动 PUT 当前 messages（覆盖写）
  │
  └─ 用户离开 → 已经存好了，什么都不做
```

### API

```
GET    /agent/sessions/:key   → { sessionKey, messages, lastActiveAt }
PUT    /agent/sessions/:key   → body: { messages }
DELETE /agent/sessions/:key   → 清空对话
```

---

## Semantic Memory（持久记忆）

### 是什么

从对话中提炼出的、跨 session 有效的认知。不是对话记录，是"这个用户是谁、有什么偏好、项目进展到哪了"。

### 数据模型

```
AgentMemory {
  _id      : ObjectId
  type     : AgentMemoryType   // 'user' | 'project'
  title    : string            // 一行摘要（≤100 字），同时作为唯一标识
  content  : string            // 完整内容（≤2000 字，markdown）
  createdAt: Date
  updatedAt: Date
}
```

没有 `key` 字段。`title` 就是标识——由 Memory Agent 决定，不由主 agent 操心。

### 2 种类型

| type | 语义 | System Prompt 加载方式 | 举例 |
|------|------|----------------------|------|
| `user` | 关于用户本人 | **始终全文注入** | 职业背景、写作风格偏好、沟通习惯、用户的纠正 |
| `project` | 关于用户的事 | **只注入 title**，SessionLoad hook 按需加载 | 文章进展、写作计划、参考资料 |

### 记忆写入：Memory Agent

主 agent 不直接写数据库。它调 `remember("不要用通俗来说开头")`，只传一句话。

后面的事由 **Memory Agent** 处理——一个专门管理记忆的子 agent：

```
主 agent 调 remember("不要用通俗来说开头")
  │
  ▼
Memory Agent 收到任务（一次独立的 LLM 调用，standard tier）：
  │
  │  输入：
  │    - 新信息："不要用通俗来说开头"
  │    - 已有记忆列表：
  │        [user] 写作风格偏好: 偏好短句，每段不超过5行...
  │        [user] 用户职业背景: 数据分析师...
  │        [project] 量子计算入门文章: 大纲已完成...
  │
  │  Memory Agent 判断：
  │    "这是用户的通用写作偏好 → type: user"
  │    "已有一条'写作风格偏好'记忆 → 合并进去"
  │
  │  输出：
  │    { action: "update", title: "写作风格偏好",
  │      content: "偏好短句，每段不超过5行。不用成语。
  │               不要用'通俗来说'作为段落开头。
  │               写科普时准确性优先，反感过度简化。" }
  │
  ▼
写数据库（upsert by title）
```

**Memory Agent 的职责：**
1. **分类**：这条信息是 user 还是 project？
2. **去重**：已有记忆里有没有相关的？
3. **合并**：有 → 更新已有记忆的 content；没有 → 创建新记忆
4. **保留语境**：特定场景的偏好不泛化（"这篇别用表格" → 归到对应 project）

**为什么用 agent 而不是规则？**
因为去重和合并需要语义理解。"写作风格偏好"和"不要用通俗来说"——字面无交集，但语义上应该合并。只有 LLM 能做这个判断。

**Memory Agent 的 system prompt：**

```
你是一个记忆管理器。你的任务是将新信息整合到已有的记忆库中。

规则：
- 判断新信息是关于用户本人（type: user）还是关于某件具体事（type: project）
- 检查已有记忆中是否有相关条目：有 → 合并内容；没有 → 新建
- user 类型：通用偏好、背景、习惯。只有用户明确表达为通用时才归 user
- project 类型：特定事情的进展、决策、上下文。不确定时归 project（宁窄不泛）
- 合并时保留已有内容中仍然有效的部分，追加新信息
- title 要简洁明确，作为记忆的唯一标识

输出 JSON：
{ "action": "update" | "create", "type": "user" | "project", "title": "...", "content": "..." }
```

### 记忆读取：系统自动 + hooks

主 agent 不需要"查记忆"的工具。记忆由 hooks 自动加载：

| 操作 | 谁负责 | 怎么做 |
|------|--------|--------|
| **user 记忆加载** | BeforeChat hook | 始终全文注入 system prompt |
| **project 标题列表** | BeforeChat hook | 始终注入 memory_index |
| **project 全文加载** | SessionLoad hook | 根据文档标题自动匹配相关 project 记忆 |
| **remember** | 主 agent 调工具 → Memory Agent 处理 | 两条路径：对话中主动 + compaction 自动 |
| **forget** | 主 agent 调工具 | 直接删 |

### 记忆删除：forget 工具

主 agent 调 `forget("量子计算入门文章")`，系统用 title 模糊匹配找到对应记忆删除。

---

## System Prompt 注入结构

```xml
<role>
你是 Liminal Field 的写作顾问 AI。
...（角色定义，不变）
</role>

<memory_protocol>
工作过程中，发现值得记住的信息随时调用 remember 工具。
你只需要说"记住什么"，记忆系统会自动处理分类、去重和合并。
假设 context 随时可能被重置——没写进记忆的东西会丢失。
</memory_protocol>

<core_memories>
（自动注入 type=user 的全部记忆，完整 content）

[写作风格偏好]
偏好短句，每段不超过5行。不用成语。不要用'通俗来说'作为段落开头。
写科普时准确性优先，反感过度简化。

[用户职业背景]
数据分析师，关注数据可视化和统计方法。
沟通风格：要求回答简洁直接，不要口语化表达。
</core_memories>

<memory_index>
（自动注入 type=project 的 title 列表）

可用记忆（已根据当前文档自动加载相关内容）：
- 量子计算入门文章的进展
- 给妈妈解释AI的写作计划
</memory_index>

<instructions>
- 优先使用工具获取信息，不要凭空猜测
- 回答使用中文，除非用户明确要求其他语言
- 不要在回答中重复用户已说过的内容
- 不要生成完整的文章草稿，聚焦在建议和改进方向
</instructions>

<current_document>
...（文档画像：标题 + 字数 + 大纲，由业务层注入）
</current_document>
```

### 与现状的对比

| 维度 | 现在 | 改后 |
|------|------|------|
| 记忆注入 | 全量灌入 50 条 × 500 字 | user 全文 + project 标题 + 相关 project 自动加载 |
| 记忆写入 | 主 agent 自己决定 key/type/title/content | 主 agent 只说"记住这个"，Memory Agent 处理分类、去重、合并 |
| 记忆读取 | agent 调工具 list + read | hooks 自动加载，agent 不需要工具 |
| 记忆删除 | 无 | `forget(描述)` |
| 记忆结构 | `content + category` | `type + title + content`，title 是唯一标识 |

---

## Compaction 与记忆巩固

Compaction 也由 Memory Agent 处理——它是 Memory Agent 的一种任务类型，不是独立的服务。

```
Compaction 触发（totalRounds ≥ 16）
  │
  ▼
Memory Agent 收到 compact 任务（一次 LLM 调用）：
  输入：旧消息 + 旧 summary + 已有记忆列表
  输出：{ summary: "压缩后的摘要", memories: [{ action, type, title, content }, ...] }
  │
  ├─ summary → 更新 session 的 summary 字段
  └─ memories → 逐条 upsert 到数据库（复用 remember 的去重合并逻辑）
```

### Memory Agent 统一入口

所有记忆写入都经过 Memory Agent，没有例外：

| 任务 | 触发 | Memory Agent 做什么 |
|------|------|-------------------|
| `remember(content)` | 主 agent 对话中调用 | 分类、去重、合并、写入 |
| `forget(description)` | 主 agent 对话中调用 | 匹配、删除 |
| `compact(oldMessages)` | AfterChat hook 自动触发 | 压缩摘要 + 提取 facts + 分类去重写入 |

一个 agent，一套记忆管理逻辑，统一心智。

---

## 后续可迭代

| 机制 | 做什么 | 说明 |
|------|--------|------|
| **Tool Result Clearing** | 清理旧工具返回结果，释放 context 空间 | 需要 token 计数能力 |
| **Session 过期清理** | 清理长期不活跃的 session | 不紧急 |
| **Memory Dreaming** | 定期跨 session 重组记忆（类似 Claude Dreaming） | 需要积累足够多的 session 数据 |

---

## 动态示例：一个用户的完整旅程

### Session 1：用户第一次打开编辑器

System prompt 中 `<core_memories>` 和 `<memory_index>` 都为空（没有任何记忆）。

用户说："我是做数据分析的，帮我看看这篇文章的结构"

Agent 回答后，调用：
```
remember("用户是数据分析师，关注数据可视化和统计方法")
```

Memory Agent 处理：没有已有记忆 → 新建
```json
{ "action": "create", "type": "user", "title": "用户职业背景",
  "content": "数据分析师，关注数据可视化和统计方法" }
```

对话继续，用户说："别用这种口水话，简洁点"

Agent 调用：
```
remember("用户要求回答简洁直接，不要口语化表达")
```

Memory Agent 处理：已有"用户职业背景" → 但这不是职业信息，是沟通偏好 → 新建
```json
{ "action": "create", "type": "user", "title": "沟通风格偏好",
  "content": "要求回答简洁直接，不要口语化表达" }
```

Session 结束，对话自动保存到 `agent_sessions`。

### Session 2：用户第二天回来

前端加载 session → 历史对话恢复。

同时，system prompt 中自动注入了：
```xml
<core_memories>
[用户职业背景]
数据分析师，关注数据可视化和统计方法

[沟通风格偏好]
要求回答简洁直接，不要口语化表达
</core_memories>
```

Agent 看到 core memories，自然就知道用户是谁、该用什么语气。**不需要任何规则——上下文给对了，它自己就知道。**

### Session 3：用户说了新偏好

用户说："以后别用'通俗来说'这种开头了"

Agent 调用：
```
remember("用户不喜欢'通俗来说'作为段落开头")
```

Memory Agent 处理：已有"沟通风格偏好" → 这也是风格偏好 → 合并
```json
{ "action": "update", "type": "user", "title": "沟通风格偏好",
  "content": "要求回答简洁直接，不要口语化表达。不要用'通俗来说'作为段落开头。" }
```

**主 agent 不需要知道已有的记忆叫什么 title、内容是什么。它只说"记住这个"，Memory Agent 自动找到对应的记忆合并。**

### Session 5：用户在写另一篇文章

Session 3 中还聊了量子计算文章的进展，compaction 自动提取了：
```
fact: "量子计算入门文章大纲已完成，正在写第二章"
→ Memory Agent: create, type=project, title="量子计算入门文章的进展"
```

现在用户打开另一篇文章。SessionLoad hook 判断文档标题跟"量子计算"无关 → 不加载这条 project 记忆的全文。System prompt 中只有标题列表：

```xml
<core_memories>
（用户职业背景 + 沟通风格偏好，始终在）
</core_memories>

<memory_index>
- 量子计算入门文章的进展
</memory_index>
```

量子计算的完整内容不占 context 空间。
