# Agent 数据库设计

> 状态：定稿 | 创建：2026-05-22

---

## 集合总览

Agent 相关新增 2 张表，与已有的 `system_config` 联动：

```
system_config（已有）    ← 新增 agentConfigs 子文档数组
agent_sessions（新建）   ← 会话存档
agent_lux_memories（新建）← lux-stirring 的持久记忆
```

---

## system_config — 新增 agentConfigs 子文档

已有的 `system_config` 单例文档，新增一个 `agentConfigs` 数组，管理各个 agent 入口的配置。

```
SystemConfig {
  ...已有字段...
  
  agentConfigs: AgentConfig[]    // ← 新增
}

AgentConfig（子文档）{
  key           : string         // 唯一标识，如 "writing-advisor"
  name          : string         // 显示名称，如 "写作顾问"
  description   : string         // 一句话描述
  enabled       : boolean        // 是否启用
  systemPrompt  : string         // 自定义 system prompt，为空用默认
  tools         : string[]       // 启用的工具名列表
  tier          : string         // 默认模型层级：flash | standard | think
}
```

**预置数据**：

```json
{
  "key": "writing-advisor",
  "name": "写作顾问",
  "description": "帮助改善文章结构、逻辑脉络和表达方式",
  "enabled": true,
  "systemPrompt": "",
  "tools": ["search_knowledge_base", "read_document_content", "get_current_draft", "remember", "forget"],
  "tier": "standard"
}
```

**设计要点**：
- 不新建集合——单用户场景，入口就 2-3 个，子文档足够
- `systemPrompt` 为空时用 PromptHandler 的默认 prompt，非空时追加到末尾
- `tools` 是白名单——ToolAssembler 只注册列出的工具
- 前端根据 `enabled` 决定是否渲染 AI 面板

---

## agent_sessions — 会话存档

每个 session 的完整对话记录 + compaction 摘要。

```
AgentSession {
  _id           : ObjectId
  sessionKey    : string           // 唯一索引，如 "draft-{contentItemId}"
  messages      : Object[]         // UIMessage[]，最近 N=8 轮
  summary       : string           // compaction 产生的摘要，默认 ''
  totalRounds   : number           // 历史总轮数（含已压缩），默认 0
  tasks         : Array<{          // 任务列表，agent 通过工具管理
                    id: string,                      // nanoid，引用标识
                    title: string,                   // 标题，展示用
                    description: string,             // 详细描述
                    status: 'pending' | 'in_progress' | 'done',
                    blocks: string[],                // 我挡着谁（task ID 列表）
                    blockedBy: string[],             // 我被谁挡着（task ID 列表）
                    metadata: Record<string, unknown>, // 扩展字段
                    createdAt: string,               // 创建时间
                    completedAt: string | null,      // 完成时间
                  }>
  lastActiveAt  : Date
  createdAt     : Date
}
```

**索引**：`sessionKey` 唯一索引

**生命周期**：
- 用户打开草稿 → 加载 session → 恢复对话
- 每轮 AI 回复完成 → 覆盖保存 messages
- 总轮数 ≥ 16 → compaction 压缩旧消息到 summary
- 草稿提交后 → session 可清理（新编辑是新 session）

---

## agent_lux_memories — 持久记忆

lux-stirring 的持久记忆。所有写入通过 Memory Agent 管理。

```
AgentMemory {
  _id           : ObjectId
  type          : string           // 'user' | 'project'
  title         : string           // 唯一索引，Memory Agent 命名（≤100 字）
  content       : string           // 完整内容（≤2000 字，markdown）
  createdAt     : Date
  updatedAt     : Date
}
```

**索引**：`title` 唯一索引

**type 与加载策略**：

| type | 含义 | System Prompt 加载 |
|------|------|-------------------|
| `user` | 关于用户本人 | 始终全文注入 `<core_memories>` |
| `project` | 关于用户的事 | 标题列表注入 `<memory_index>`，SessionLoad hook 按文档标题匹配加载全文 |

**写入路径**：
- 主 agent 调 `remember(content)` → Memory Agent（LLM）分类/去重/合并 → upsert by title
- Compaction 提取 facts → Memory Agent → upsert by title

**无 key 字段**：title 就是唯一标识，由 Memory Agent（LLM）决定命名。不做正则转换。

---

## 集合关系

```
system_config
  └── agentConfigs[]        入口配置（决定 prompt、工具集、是否启用）
        │
        │  配置影响运行时行为
        ▼
agent_sessions              会话存档（对话消息 + 摘要）
        │
        │  对话中 agent 调 remember
        ▼
agent_lux_memories          持久记忆（跨 session 共享）
```

- `system_config.agentConfigs` 影响 BeforeChat hook（选哪些工具、用什么 prompt）
- `agent_sessions` 和 `agent_lux_memories` 无直接外键关系——记忆独立于任何 session
- 任务存在 `agent_sessions.tasks` 字段中——跟 session 走，不单独建表
