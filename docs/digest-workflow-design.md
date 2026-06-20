# 智能采集工作流设计 (task #36 / #37)

> 范式对齐 tongtianxiao 的 ReAct 精华，做了 digest 场景的简化。

## 1. 核心范式

- **3 节点 graph**：`react_agent → compose → commit`
- **react_agent** 内部用 **Vercel AI SDK `generateText + stepCountIs + tools`** 实现 ReAct loop（不另外引 LangGraph reasoning/action 双节点）
- **工具按能力抽象**（不按 type 映射）—— LLM 看到统一的 list/fetch/search/read/save 能力，后端 Fetcher 接口按 type 分发
- **react_agent prompt 极简**：给任务 + 工具 + 终止信号，信任模型
- **compose prompt 严格约束**：禁评论 / 禁推测 / 禁综合判断 / 每句 [CIT N]
- **LLM 输出 zod schema 强校验**
- **全局 prompts 目录** `server/src/prompts/digest/`，用 `PromptManagerService` 模板渲染
- **每事项独立 cron job**（SchedulerRegistry 动态注册，task #37）

## 2. 工作流 graph

```
START
  ↓
react_agent  Vercel AI SDK generateText + stepCountIs(20) + tools
             LLM 自由 ReAct：list → fetch → search → read_full →
                            save_finding → ... → FINISH
  ↓
compose      一次性 LLM 调用，所有 findings 一起喂进 prompt
             严格约束输出："事实陈述 + [CIT N] + 不评论"
  ↓
commit       code only：拼最终 markdown + ContentSnapshot 入库 +
             写 ProcessedFeedItem 命中记录 + DigestTask 状态
  ↓
END
```

## 3. 数据模型

### 3.1 新增 ProcessedFeedItem（去重 + 历史查询）

```ts
{
  _id: string;              // pfi_xxx
  topicId, sourceId, itemGuid: string;
  title, url: string;
  pickedAt: Date;
  reportContentItemId: string;  // 命中入了哪份报告（NavigationNode）
}
// 唯一索引 (topicId, itemGuid)
// 普通索引 (topicId, pickedAt: -1)
```

### 3.2 新增 DigestTask（graph state 持久化 + 前端可查状态）

```ts
{
  _id: 'dt_xxx',
  topicId: string;
  status: 'running' | 'done' | 'failed';
  findings: Finding[];      // react_agent 阶段 LLM 通过 save_finding 累积
  reportContentItemId?: string;  // commit 后回写
  reportSummary?: string;        // 报告 markdown 的前 N 字（前端预览）
  error?: string;
  traceId: string;
  iterations: number;        // react_agent 跑了几轮
  llmCallsCount: number;
  startedAt: Date;
  completedAt?: Date;
}

Finding {
  citationId: number;       // [CIT N] 里的 N，全局递增
  sourceId, sourceName: string;
  itemGuid, title, url: string;
  publishedAt?: Date;
  snippet: string;          // RSS 摘要 / 用户保留的全文片段
  reason: string;           // LLM 给的"为啥挑这条"
}
```

### 3.3 SmartTopicConfig 不动

字段不加，first iteration 极简（不带 extractFields / topN）。

## 4. 工具集（6 个抽象能力）

```ts
digest.list_sources(topicId)
  → 返回 [{ id, name, type, description, capabilities: [...] }]
  → 让 LLM 看到事项订阅的所有源，含每个源的能力清单

digest.fetch_source(sourceId, limit?, since?)
  → 拉某源最新 items
  → 内部按 source.type 分发 RssFetcher / WebpageFetcher / ...
  → 返回 [{ itemGuid, title, url, publishedAt, snippet }]

digest.search_source(sourceId, query)
  → 在某源里搜某主题
  → RSS 实现：在 items 里 full-text 过滤
  → 网页/API 等扩展时各自实现

digest.read_item_full(sourceId, itemGuid)
  → 拉某条 item 的全文（snippet 不够时深挖）
  → RSS 实现：返回 content:encoded 字段（如有），无则 fallback 到 snippet

digest.get_recent_picks(topicId, days?)
  → 查最近 N 天该事项已推过的 ProcessedFeedItem
  → LLM 用它做去重判断

digest.save_finding(itemIds, reason)
  → 把 items 标记进入本期 findings
  → 后端给每个 item 分配 citationId（递增）+ 写进 DigestTask.findings
```

**FINISH 不是工具，是 LLM 直接停止调工具**（Vercel AI SDK 通过 stepCountIs 兜底，正常路径 LLM 写文字"已完成"即停）。

## 5. 节点定义

| 节点 | 输入 | 调用 | 输出 |
|---|---|---|---|
| **react_agent** | 事项 prompt + topicId | `generateText` + stepCountIs(20) + 6 工具 | `DigestTask.findings` 累积 |
| **compose** | `findings`（含 [CIT N] 编号） | `generateText` + `compose-report.md` system prompt + zod 校验 | markdown 报告（含 `[CIT N]`） |
| **commit** | markdown + findings | code: createContent / NavigationNode / saveContent commit | `reportContentItemId` |

## 6. Prompts

```
server/src/prompts/digest/
├── react-agent.md         极简，描述任务+工具+终止
└── compose-report.md      严格约束，禁评论/推测/综合
```

### react-agent.md（草稿，~30 行）

```markdown
# Role
你是「{{topic_name}}」的研究员。

# Task
本期任务：从订阅的信息源里挑选**跟事项关注点相关的优质条目**，
逐个用 `save_finding` 加入本期 findings。完成后停止调工具。

# 事项关注点
{{topic_prompt}}

# 可用工具
- `list_sources(topicId)`         列出本事项订阅的信息源
- `fetch_source(sourceId, limit?)` 拉源最新条目
- `search_source(sourceId, query)` 在源里搜某主题
- `read_item_full(sourceId, itemGuid)` 拉某条全文
- `get_recent_picks(topicId, days?)` 查历史已推条目（去重参考）
- `save_finding(itemIds, reason)`  把 items 加入本期 findings

# 说明
- 优质标准：内容直接相关 / 含具体事实数据 / 来源可信
- 不必每源都拉完，看到没价值的可停
- 信任你自己的判断
```

### compose-report.md（草稿，~50 行）

```markdown
# Role
你是「{{topic_name}}」的**事实编辑**（不是评论员）。

# Background
输入是已经编辑筛选的 findings 列表，每条带 [CIT N] 编号。
你的工作**不是评论、不是综合、不是预测**，
而是把这些事实重新组织成简报。

# Task
1. 看所有 findings，找出 2-4 个主题聚类
2. 每个聚类一个 `##` 二级章节
3. 章节内用最简陈述把事实拼成段落
4. 每个事实末尾标 `[CIT N]`（N 严格对应输入编号）

# Output format
- `##` 二级标题章节
- 全文 400-600 字
- **不要写「参考资料」列表**（系统会自动追加）
- markdown 格式

# Constraints
✘ 禁止主观评价（"两极分化"、"标志着"、"重塑了"、"业内反响"）
✘ 禁止推测因果（"这意味着"、"预示着"、"或将"）
✘ 禁止综合判断或预测
✓ 只许陈述输入里的事实
✓ 每句话末尾 `[CIT N]`

# Input
{{findings_text}}

# Output
Return JSON: { "headline": string, "markdown": string }
- headline: 本期标题，≤ 25 字，不要带书名号
- markdown: 报告正文（章节 + 引用）
```

## 7. 模块结构

```
server/src/
├── infrastructure/prompt/
│   ├── prompt-manager.service.ts          fs 读 .md + Mustache-style {{var}} 替换
│   └── prompt-manager.module.ts
├── prompts/digest/
│   ├── react-agent.md
│   └── compose-report.md
└── modules/digest/
    ├── workflow/
    │   ├── digest-workflow.service.ts     runOnce(topicId) 入口
    │   └── nodes/
    │       ├── react-agent.node.ts        ReAct loop
    │       ├── compose.node.ts            一次性写报告
    │       └── commit.node.ts             入库
    ├── tools/
    │   ├── list-sources.tool.ts
    │   ├── fetch-source.tool.ts
    │   ├── search-source.tool.ts
    │   ├── read-item-full.tool.ts
    │   ├── get-recent-picks.tool.ts
    │   └── save-finding.tool.ts
    ├── fetchers/
    │   ├── fetcher.interface.ts
    │   ├── rss-fetcher.service.ts         rss-parser 实现
    │   └── fetcher-registry.service.ts    按 type 分发
    ├── processed-feed-item.entity.ts + repository
    ├── digest-task.entity.ts + repository
    ├── digest-scheduler.service.ts        (task #37)
    └── digest-workflow.controller.ts      POST /digest/topics/:id/run-now
```

## 8. 新增依赖

```json
{
  "rss-parser": "^3.x"
}
```

**不引** LangGraph / LangChain 任何包——3 节点 graph 在 NestJS service 里手写编排足够。
ReAct loop 用现有 Vercel AI SDK 内置的 `stepCountIs` 实现。

## 9. 子任务拆解

| 子任务 | 范围 | commit |
|---|---|---|
| **#36a 基建** | PromptManagerService + prompts/digest/ + ProcessedFeedItem + DigestTask entity/repository + 单测 | 1 |
| **#36b RSS Fetcher** | rss-parser 集成 + FetcherInterface + RssFetcher + FetcherRegistry + 单测 | 1 |
| **#36c 工具集** | 6 个工具实现（包装成 Vercel AI SDK 的 tool() 形态） + 单测 | 1 |
| **#36d 工作流核心** | react-agent / compose / commit 节点 + DigestWorkflowService.runOnce + 集成测试（mock LLM） | 1 |
| **#36e Controller** | POST /digest/topics/:id/run-now + GET /digest/tasks/:id + 状态 DTO | 1 |
| **#36f Prompt 占位** | react-agent.md + compose-report.md 写到 §6 的草稿（实际跑通后再调优） | 含在 #36a |
| **#37 Scheduler** | DigestSchedulerService + TopicService 钩接（onCreate/onUpdate/onDelete 时 reschedule） | 1 |

## 10. 验收

- [ ] 配一个事项 + 1 个真实 RSS 源
- [ ] `POST /digest/topics/:id/run-now` 返回 task_id
- [ ] log 看到 react_agent loop 推进、调工具、save_finding
- [ ] DigestTask.status 推进到 done，findings 数 > 0
- [ ] 报告 markdown 含 `[CIT N]` 引用，且数量跟 findings 对应
- [ ] 公开 `/digest/:topicId/:reportId` 渲染该报告
- [ ] 报告只陈述事实，无评论 / 推测 / 综合判断

## 11. 跟 tongtianxiao 对照

| tongtianxiao | 我们 |
|---|---|
| LangGraph reasoning / action 双节点 | Vercel AI SDK stepCountIs ReAct 内置循环 |
| `DeepResearchTaskEntity` | `DigestTask` |
| `ChatterService` | Vercel AI SDK `generateText` |
| `PromptManagerService` | 同名，简化版 |
| 三步思维链强约束（统合 / 缺口 / 决策） | 极简 prompt，信任模型 |
| `retrieveFromQdrant(query)` 单工具 | 6 个能力抽象工具 |
| `intentAnswer` + `insights` 多次生成 | 一次性 compose 生成 |
| `[@#CIT N]` 引用 | `[CIT N]` 引用 |
| 2500+ 字长报告 | 400-600 字短报告 |
| 用户 query 驱动 | cron + 事项 prompt 驱动 |
