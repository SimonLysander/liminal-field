# Agent 系统设计经验沉淀

> 创建：2026-05-22 | 覆盖：记忆系统、工具系统、Hooks 架构、UI 设计

---

## 一、记忆系统

### 会话就是记忆的基础

一开始想直接做"智能记忆"——tags、importance、语义搜索。用户一句话点醒：**先把单 session 的对话持久化做好，这是整个记忆的基础。**

Claude Code 也是这样：context window 里的消息就是 working memory，满了就压缩（compaction），跨 session 才用文件式持久记忆。

**教训**：不要跳过基础直接做高级功能。

### 三层不是三个系统，是一个流

Working Memory → Episodic Memory → Semantic Memory 不是三个独立系统，是一个数据流：

```
对话进行（Working）→ 保存消息（Episodic）→ 提取认知（Semantic）→ 注入下次对话（Working）
```

Compaction 是这个流的关键节点——同时做压缩（Episodic）和提取（Semantic）。

### 记忆类型只需两种

最初设计了 4 种（user / feedback / project / reference），后来砍到 2 种：

- **user**：关于用户本人（始终全文注入 system prompt）
- **project**：关于用户的事（只注入标题，按需加载）

区分标准不是"内容是什么"，而是"加载策略是什么"。如果始终需要 → user；如果按需 → project。

### Memory Agent 是统一管道

所有记忆写入通过 Memory Agent——remember、forget、compact 都走它。主 agent 只说"记住这个"，Memory Agent 决定分类、去重、合并。

**关键决策**：主 agent 的 remember 工具只接收一个 `content` 字符串。不传 type、不传 title、不传 key。Memory Agent 自己读 session 上下文判断。

**原则**：如无必要，勿增实体。用提示词和示例引导行为，不靠枚举字段分类。

---

## 二、工具系统

### 从 agent 视角设计，不是包装 API

> "最适合 agent 的工具往往对人类来说也直观有用" — Anthropic

不是把数据库 CRUD 暴露给 agent（list + read + write + delete），而是从任务视角设计（remember + forget）。

### 外层粗，内层细

主 agent 的工具要粗粒度——`remember("用户不喜欢表格")` 一步搞定。Memory Agent 内部可以 list → read → write 多步操作，但主 agent 不关心。

### description 是教程

工具的 description 不是一句话概述，要教模型怎么用——使用场景、参数写法（好/坏示例）、与其他工具的关系。微小的 description 改进能产生显著的性能提升。

用 JSON Schema 的 `examples` 字段提供调用示例。

### 一次给够

工具返回要让 agent 能直接做决策。search 返回带 scope 标记 + 字数 + 时间，agent 一眼判断相关性，不用再调 read 补信息。

### 错误返回要可操作

```
✗ "Error 404"
✓ "未找到标题为'量子计算'的记忆。当前有以下记忆：[列表]"
```

---

## 三、Hooks 架构

### 同步流水线 + 异步事件

两种 hook 性质不同，用不同机制：

- **同步**（SessionLoad、BeforeChat）：用组合式 Handler，输出给下一步用
- **异步**（AfterChat）：用 @nestjs/event-emitter，fire-and-forget

### Handler 层是关键

SessionHandler / MemoryHandler / PromptHandler / ToolAssembler——各司其职，AgentLifecycle 只做编排。这样：

- 每个 handler 可独立测试
- 新入口的 agent 可以复用 handler，换 prompt 和 tools
- 加异步行为（如 token 统计）只需加 `@OnEvent` listener，不改现有代码

### 不用 EventEmitter 做同步 hook

EventEmitter 的 listener 改 event 对象是副作用，顺序难保证，返回值难处理。同步流水线就直接调方法。

---

## 四、配置接入

### 配置不新建表

单用户场景，agent 入口就 2-3 个。放 system_config 的 subdocument 数组，不新建集合。

### 配置要打通到行为

Settings 里能编辑不等于能生效。`enabled` 要控制前端渲染，`systemPrompt` 要注入 prompt，`tools` 要过滤工具集，`tier` 要决定模型。每个配置字段都要有对应的运行时读取。

---

## 五、UI 设计

### 极简但有辨识度

- 工具调用：不要 6 种图标。一个 pulse 状态点 + 工具名，颜色区分状态
- 空状态：问候语 + 预设问题卡片（让用户知道能问什么）
- streaming：不要三个跳动的点，换成 pulse 点 + "思考中"

### 对话与操作分层

工具调用是轻量的内联指示器，不是占位置的卡片。对话消息是主体。

### Agent UI ≠ Chatbot UI

Agent 需要：操作可见性、干预点、状态追踪。不只是对话气泡。

---

## 六、踩过的坑

### 1. 不要跳过调研直接写代码

最初想直接写记忆系统，用户要求"先调研业界怎么做"。调研后发现 Claude Code 的做法比我想的简单得多——文件式 CRUD + auto hooks。架构从"复杂的向量搜索"转向"简单的 title 匹配 + LLM 判断"。

### 2. 不要用枚举字段代替提示词

给 remember 工具加了 `source: "user_explicit" | "agent_inferred"` 字段——你不能保证模型填对了。一段好的提示词 + 示例比枚举字段更可靠。

### 3. 不要把业务概念混入基础设施

记忆系统不该有 `contentItemId`、`scope` 这种业务字段。session 也不绑定"草稿"——sessionKey 是不透明字符串，业务层决定它的语义。

### 4. session 不等于草稿

session 是通用基础设施。`sessionKey = "draft-xxx"` 是业务层的用法，不是 session 的定义。未来相册 agent 有自己的 session key。

### 5. 表名要有辨识度

`agent_memories` → `agent_lux_memories`。一看就知道是谁的记忆。`agent_sessions` 保持通用，因为 session 不绑定用户身份。

### 6. generateObject 不是 agent

最初的 Memory Agent 用 `generateObject` 一次性输出 JSON——这不是 agent，是一次函数调用。真正的 agent 应该有自己的工具集、能多步推理、能查看已有数据后再决策。

---

## 七、参考来源

| 来源 | 核心价值 |
|------|---------|
| Claude Code 记忆系统 | 文件式 CRUD + auto hooks + MEMORY.md 索引 |
| Claude Dreaming | 离线跨 session 记忆重组 |
| Anthropic Memory Tool API | 6 个文件操作命令，客户端实现 |
| Anthropic "Writing tools for agents" | 工具 description = 教程，错误返回要可操作 |
| Anthropic "Effective context engineering" | 压缩-重置-恢复循环，最小化高信号 token |
| Mem0 | 原子化 fact 提取 + 向量+图双存储 |
| Letta/MemGPT | OS 虚拟内存隐喻：core/recall/archival 三层 |
| Code Master 工具经验 | 一次给够、预计算、上下文隔离、handbook 只放必要信息 |
