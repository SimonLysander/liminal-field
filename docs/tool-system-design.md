# Agent 工具系统设计

> 状态：设计中 | 创建：2026-05-21 | 更新：2026-05-22

---

## 设计原则

### 1. 从 agent 视角设计，不是包装 API

> "最适合 agent 的工具往往对人类来说也直观有用" — Anthropic

不是把数据库 CRUD 暴露给 agent，而是从 agent 的任务视角设计——它要做什么事，给它一个能做成这件事的工具。

```
✗ 数据库思维：list_memories + read_memory + write_memory + delete_memory
✓ 任务思维：remember("用户不喜欢表格") → 系统自动处理分类、去重、合并
```

### 2. 外层粗，内层细

主 agent 的工具要粗粒度——一次调用完成一件事。内部实现可以有多步操作。

```
主 agent 调用：remember("用户不喜欢表格")   ← 一个参数，一步搞定
  └── Memory Agent 内部：list → read → 判断 → write   ← 多步操作，主 agent 不关心
```

类比 Anthropic 的例子：`get_customer_context` 对外一步拿到客户全貌，内部可能查了 3 张表。

### 3. 一次给够

工具返回的信息要让 agent 能直接做决策，不需要再调一次工具补信息。

```
✗ search 只返回 {id, title, snippet} → agent 要再调 read 才能判断相关性
✓ search 返回 {id, title, scope, wordCount, updatedAt, snippet} → 一步到位
```

### 4. 返回画像，不返回 dump

返回结构化的"画像"，不是原始 dump。但工具只返回客观数据，分析让 agent 做。

### 5. description 是教程，不是一句话

工具的 description 要像给新员工介绍工具一样——使用场景、输入要求、好坏示例、与其他工具的关系。微小的 description 改进能产生显著的性能提升。

### 6. 错误返回要可操作

```
✗ "Error 404"
✓ "未找到标题为'量子计算'的记忆。当前有以下记忆：[列表]。请检查标题是否正确。"
```

### 7. 如无必要，勿增实体

不要用枚举字段来分类（`source: "user_explicit" | "agent_inferred"`），用提示词和示例引导就够了。你不能保证字段分类是对的，但好的示例能教会模型正确的行为。

### 8. 工具命名显而易见

```
✗ get_content / read_doc / search
✓ get_current_draft / read_document_content / search_knowledge_base
```

---

## 两层工具架构

```
┌─ 主 Agent（写作顾问）──────────────────────────┐
│                                                 │
│  工具集（粗粒度，面向任务）：                      │
│    search_knowledge_base                        │
│    read_document_content                        │
│    get_current_draft                            │
│    remember         ──→  Memory Agent           │
│    forget            ──→  Memory Agent           │
│    sub_agent         ──→  子 Agent               │
│                                                 │
└─────────────────────────────────────────────────┘

┌─ Memory Agent（记忆管理）──────────────────────┐
│                                                 │
│  工具集（细粒度，CRUD）：                         │
│    list_memories                                │
│    read_memory                                  │
│    write_memory                                 │
│    delete_memory                                │
│                                                 │
│  上下文：自动注入最近 N 轮对话，                   │
│         Memory Agent 自己判断语境                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 主 Agent 工具清单

### search_knowledge_base

```
description:
  在用户的知识库中搜索已发布的内容（笔记、相册、文集）。

  使用场景：
  - 用户提到"我之前写过…"时，搜索相关内容
  - 需要引用用户已有的内容来辅助建议时
  - 用户问"有没有关于 X 的笔记"时

  查询技巧：
  - 用关键词搜索，不要用完整句子
    ✓ query: "量子计算"
    ✗ query: "我之前写过的关于量子计算的笔记"
  - scope 可选，不确定内容在哪个范围时不传

  返回结果包含 contentItemId，如需查看完整正文，
  用该 ID 调用 read_document_content。

参数：
  query: string       // 必填，搜索关键词
  scope?: string      // 可选，notes | gallery | anthology

返回示例：
  [notes] 量子计算入门笔记 (2026-05-20)
    abc123
    ...量子比特是量子计算的基本单元...

  共 2 条结果

异常返回：
  "没有找到匹配的内容"
  "搜索失败，请尝试其他关键词"
```

---

### read_document_content

```
description:
  读取一篇已发布内容的完整正文。

  使用场景：
  - search_knowledge_base 找到相关内容后，需要看完整正文时
  - 用户说"帮我看看那篇 XX"时

  注意：
  - 只能读已发布的内容，当前正在编辑的草稿请用 get_current_draft
  - contentItemId 从 search_knowledge_base 的结果中获取
  - 返回的正文最多 2000 字，超长内容会被截断
  - 大部分情况下 search_knowledge_base 的摘要已经够用，
    不需要每条结果都调 read_document_content

参数：
  contentItemId: string   // 必填，从搜索结果中获取

返回：
  { title, wordCount, outline, body }

异常返回：
  "无法读取文档（id: abc123），请确认 ID 是否正确"
```

---

### get_current_draft

```
description:
  获取用户当前正在编辑的草稿全文。

  使用场景：
  - 用户问"这篇文章的结构/逻辑/表达有什么问题"时
  - 需要分析文章具体内容（而不只是大纲）时

  注意：
  - system prompt 中已有文档画像（标题 + 字数 + 大纲），
    如果只需要了解文章结构，不必调这个工具
  - 只有需要读正文细节时才调用
  - 返回的是打开文档时的快照，用户后续的编辑不会实时反映

参数：无

返回：
  { contentItemId, title, wordCount, paragraphs, outline, body }

异常返回：
  "当前没有打开的草稿"
```

---

### remember

```
description:
  记住一件值得长期保留的信息。记忆系统会自动判断分类、
  查找已有记忆、决定新建还是合并。

  使用场景：
  - 用户表达了偏好、习惯、背景信息时
  - 用户纠正了你的做法时
  - 对话中产生了对未来有价值的结论时
  - 不确定要不要记时，宁可记（记忆系统会去重）

  content 的写法：
  - 必须是完整的、脱离对话上下文也能理解的语句
  - 包含必要的背景（哪篇文章、什么场景）
    ✓ "用户在编辑《量子计算入门》时表示不想用表格展示数据"
    ✗ "不要表格"
    ✓ "用户是数据分析师，关注数据可视化和统计方法"
    ✗ "数据分析"
  - 不要记录临时的、只跟当前对话相关的信息

参数：
  content: string     // 必填，要记住的信息

返回：
  "已记住：合并到 [user] 沟通风格偏好"
  "已记住：新建 [project] 量子计算入门文章的进展"
```

**内部流程**：主 agent 调 remember → 系统把 content + 当前 session 最近几轮对话 → 交给 Memory Agent → Memory Agent 用自己的工具（list/read/write）多步处理 → 返回结果。

---

### forget

```
description:
  删除一条已过时或错误的记忆。

  使用场景：
  - 用户明确说"忘掉 XX"或"之前说的 XX 不对"时
  - 发现记忆中的信息已经过时时

  target 的写法：
  - 尽量使用记忆的原始标题（可以在 system prompt 的
    core_memories 和 memory_index 中看到）
    ✓ "量子计算入门文章的进展"
    ✗ "那个关于量子的"

参数：
  target: string      // 必填，要忘记的记忆标题或描述

返回：
  "已忘记：[project] 量子计算入门文章的进展"
  "没有找到与'量子计算'相关的记忆。当前有以下记忆：[列表]"
```

---

### sub_agent（待实现）

```
description:
  把一个明确的任务委派给独立的子 agent。子 agent 有自己的
  上下文和工具，完成后只返回结论。当前对话不会被中间过程干扰。

  使用场景：
  - 需要搜索 + 读多篇 + 综合分析的任务
  - 需要对比多个内容的任务
  - 任何需要 3 步以上工具调用才能完成的信息收集

  不使用：
  - 简单的单次搜索或读取
  - 需要跟用户交互确认的任务

  task 的写法：
  - 必须是明确的、可完成的任务描述
  - 先自己理解问题，再委派具体子任务
    ✓ "搜索知识库中所有关于量子计算的内容，读取正文，分析各篇核心观点和重叠部分"
    ✗ "帮我看看量子计算的东西"

参数：
  task: string        // 必填，任务描述
  max_steps?: number  // 可选，默认 8

返回：
  子 agent 的结论文本（包含探索步数和文档数）
```

---

## Memory Agent 内部工具

Memory Agent 是一个独立的子 agent，有自己的工具集和 system prompt。它在收到 remember/forget/compact 任务时启动，用 `generateText` + tools 多步推理。

### 上下文注入

Memory Agent 启动时自动注入当前 session 的最近几轮对话作为上下文，不需要主 agent 手动传。

### 工具集

| 工具 | 功能 | 参数 |
|------|------|------|
| `list_memories` | 列出所有记忆的 type + title | 无 |
| `read_memory` | 读一条记忆的完整 content | `title: string` |
| `write_memory` | 创建或更新（upsert by title） | `type, title, content` |
| `delete_memory` | 删除 | `title: string` |

### Memory Agent system prompt

```
你是一个记忆管理器，负责管理用户 lux-stirring 的持久记忆。

你的任务是将新信息整合到记忆库中。使用你的工具：
1. 先用 list_memories 查看已有记忆
2. 如果新信息可能与已有记忆相关，用 read_memory 查看完整内容
3. 决定是新建还是合并：
   - 新信息与已有记忆相关 → write_memory 更新已有记忆（合并内容）
   - 新信息是全新的 → write_memory 创建新记忆
4. 如果是删除任务，用 delete_memory

分类规则：
- type=user：关于用户本人的通用信息（偏好、背景、习惯）
- type=project：关于某件具体事（文章进展、决策、计划）
- 不确定时归 project（宁窄不泛）

以下是当前对话的最近几轮内容，帮助你理解上下文：
<recent_conversation>
{最近 N 轮对话}
</recent_conversation>
```

### 执行示例

**remember 任务：**
```
输入：content = "用户不喜欢用表格展示数据"

Memory Agent 执行：
  Step 1: list_memories()
    → [user] 写作风格偏好 / [user] 职业背景 / [project] 量子计算入门文章
  Step 2: read_memory("写作风格偏好")
    → "偏好短句，每段不超过5行。不用成语。"
  Step 3: 看对话上下文 → 用户是在编辑《量子计算入门》时说的，只是"这篇不用"
  Step 4: read_memory("量子计算入门文章")
    → "大纲已完成，正在写第二章。"
  Step 5: write_memory("project", "量子计算入门文章", "大纲已完成，正在写第二章。不用表格展示数据。")
  
返回主 agent：已记住：合并到 [project] 量子计算入门文章
```

**compact 任务：**
```
输入：旧消息文本 + 旧 summary

Memory Agent 执行：
  Step 1: 生成 summary（文本输出给调用方）
  Step 2: 从对话中发现 "用户是数据分析师" → list_memories → 没有 → write_memory("user", "职业背景", "数据分析师，关注数据可视化")
  Step 3: 从对话中发现 "文章已完成大纲" → list_memories → read_memory("量子计算入门文章") → write_memory 更新进展

返回：{ summary, memoriesExtracted: 2 }
```

---

## 选中文字：add-to-chat（非工具）

用户选中文字后提问 → 前端拼接到消息中，不是工具调用。

```
发送的消息：
  [选中文字]
  量子比特是量子计算的基本单元...
  [/选中文字]

  这段话的逻辑有问题吗？
```

前端展示选区 pill：`📎 已选中 42 字  ✕`，发送后自动清除。

---

## 工具截断策略

| 工具 | 截断限制 | 原因 |
|------|---------|------|
| `get_current_draft` | 8000 字 | 当前草稿，需要尽量完整 |
| `read_document_content` | 2000 字 | 已发布内容做参考 |
| `search_knowledge_base` | 5 条 × ~100 字 | 概览 |
| `remember` | content 不限 | Memory Agent 自行处理 |
| `sub_agent` | 不截断 | 已是综合结论 |
