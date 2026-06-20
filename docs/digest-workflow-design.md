# 智能采集工作流设计 (task #36 / #37)

> 范式严格对齐 tongtianxiao 的 deep-research：LangGraph StateGraph
> 编排 + 节点函数 + Zod 校验 + prompt 文件管理。

## 1. 范式

- **LangGraph StateGraph** 做编排（plan → execute → evaluate → compose → commit）
- **节点函数**内部调 LLM 用 **Vercel AI SDK `generateText`**（项目现状，不引 LangChain provider 包）
- **LLM 输出 Zod schema 强校验**（结构化 JSON）
- **全局 prompts 目录** `server/src/prompts/digest/*.md`，用 `PromptManagerService` 模板渲染
- **每事项独立 cron job**（SchedulerRegistry 动态注册，task #37）

## 2. 工作流 graph

```
START → plan         LLM 生成本期搜索计划 = N 个 PlanStep
        ↓
        execute      跑一个 step，调 fetch_source 等工具，收集 Findings
        ↓
        evaluate     LLM 判：findings 够吗？要不要再加 step？
        ↓
   ┌────┴────┐
need_more     ↓
   │       compose   LLM 写报告 markdown（含 [CIT N] 引用）
   └→ execute  ↓
            commit   拼最终 markdown + 入库 ContentSnapshot + 写状态
              ↓
             END
```

## 3. 数据模型（简化版，砍掉所有 LLM 主观判断字段）

### 3.1 新增 ProcessedFeedItem

只为**去重**（first iteration 不存评分 / extracted / quality）：

```ts
{
  _id: string;              // pfi_xxx
  topicId, sourceId, itemGuid: string;
  title, url: string;
  pickedAt: Date;
  reportContentItemId: string;  // 命中入了哪份报告
}
// 唯一索引 (topicId, itemGuid)
```

### 3.2 新增 DigestTask（graph state 持久化）

对照 tongtianxiao 的 `DeepResearchTaskEntity`：

```ts
{
  _id: 'dt_xxx',
  topicId: string,
  status: 'planning' | 'executing' | 'composing' | 'done' | 'failed',
  plan: PlanStep[],
  findings: Finding[],     // 所有 step 累积，给 compose 用
  reportContentItemId?: string,
  error?: string,
  traceId: string,
  createdAt, updatedAt,
}

PlanStep { index, intent, status, achievement? }
Finding {
  citationId: number;      // [CIT N] 里的 N，全局递增
  sourceId, itemGuid, title, url: string;
  snippet: string;         // RSS 摘要
  publishedAt?: Date;
}
```

### 3.3 SmartTopicConfig 不动

不加 `extractFields / topN`——结构化指标 / Top N 截断都是后续 iteration。

## 4. 工具集（给 LLM 节点调用）

```
digest.list_sources(topicId)              列事项订阅的信息源
digest.fetch_source(sourceId, since?)     拉源最新条目（rss-parser）
digest.get_recent_picks(topicId, n)       查最近 N 期已推过的（去重 + 上下文）
```

不暴露 `save_pick / commit_report` 工具——那些是工作流末端的 code action，不让 LLM 决策。

## 5. 节点定义

| 节点 | 输入 | 调用 | 输出 |
|---|---|---|---|
| **plan** | 事项 prompt + sourceIds | LLM + `plan-search.md` | `PlanStep[]` |
| **execute** | 当前 step | LLM ReAct + tools | `Finding[]` 追加进 task |
| **evaluate** | findings + plan | LLM + `evaluate-plan.md` + zod | `{need_more, new_steps?}` |
| **compose** | findings（编号 [CIT N]） | LLM + `compose-report.md` | markdown |
| **commit** | markdown + findings | code only | `reportContentItemId` |

## 6. Prompts（全局目录，按 tongtianxiao 范式）

```
server/src/prompts/digest/
├── plan-search.md
├── execute-step.md
├── evaluate-plan.md
└── compose-report.md
```

`compose-report.md` 严格结构（参考 `prompt-engineering-rationale.md`）：

```markdown
# Role
你是「{topic}」的事实编辑（不是评论员）。

# Background
输入是已经编辑筛选的精选条目。你的工作不是评论或综合，
**只把事实重新组织成分章节的简报**。

# Step by step
1. 看所有 Findings，找出 2-4 个主题聚类
2. 每聚类一个 ## 章节
3. 章节内用最简陈述把事实拼段
4. 每个事实末尾标 [CIT N]

# Output format
- ## 二级标题章节
- 全文 400-600 字
- 不写「参考资料」列表（系统自动追加）

# Constraints
✘ 禁止主观评价（"两极分化"、"标志着"、"重塑了"）
✘ 禁止推测因果
✘ 禁止综合判断或预测
✓ 每句话末尾 [CIT N]，N 严格对应输入编号

# Input
[CIT 1] {title} | {source} | {date}
        {snippet}
[CIT 2] ...
```

## 7. 新增模块结构

```
server/src/
├── infrastructure/prompt/
│   └── prompt-manager.service.ts          ~30 行 fs + {{var}} 替换
├── prompts/digest/*.md
└── modules/digest/
    ├── workflow/
    │   ├── digest-workflow.graph.ts        LangGraph 定义
    │   ├── digest-workflow.state.ts        Annotation.Root state
    │   ├── digest-workflow.service.ts      入口 runOnce(topicId)
    │   └── nodes/{plan,execute,evaluate,compose,commit}.node.ts
    ├── tools/
    │   ├── list-sources.tool.ts
    │   ├── fetch-source.tool.ts
    │   └── get-recent-picks.tool.ts
    ├── fetchers/
    │   ├── fetcher.interface.ts
    │   └── rss-fetcher.service.ts
    ├── processed-feed-item.entity.ts + repository
    ├── digest-task.entity.ts + repository
    └── digest-scheduler.service.ts         (task #37) cron 动态
```

## 8. 新增依赖

```json
"@langchain/langgraph": "...",
"@langchain/core": "...",
"rss-parser": "..."
```

**不引** `@langchain/anthropic` / `@langchain/openai` / `langchain`——
节点内部继续用项目现有的 Vercel AI SDK `generateText`。

## 9. 子任务拆解（每子任务 1 commit）

| 子任务 | 范围 |
|---|---|
| **#36a 基建** | PromptManagerService + prompts/digest/ 4 个 .md placeholder + ProcessedFeedItem + DigestTask entity/repo |
| **#36b RSS fetcher** | rss-parser 接入 + RssFetcher + fetcher interface |
| **#36c 工具集** | list_sources / fetch_source / get_recent_picks |
| **#36d 节点 + graph** | 5 个节点 + LangGraph 编排 + zod schemas |
| **#36e Prompt 实战调优** | 跑端到端，让 compose 输出符合"只陈述事实 + [CIT N]" |
| **#36f Controller** | POST /digest/topics/:id/run-now + 状态查询 |
| **#37** | DigestSchedulerService + TopicService 钩接 |

## 10. 验收

- [ ] 配一个事项 + 1 个 RSS 源
- [ ] `POST /digest/topics/:id/run-now`
- [ ] log 看到 plan → execute → evaluate → compose → commit 推进
- [ ] DigestTask 状态推进可见
- [ ] 报告 markdown 含 `[CIT N]` 引用
- [ ] 公开 `/digest/:topicId/:reportId` 渲染该报告
- [ ] 报告**只陈述事实** + 来源链接，**没有** LLM 主观评论

## 11. 跟 tongtianxiao 对照表

| tongtianxiao | 我们 |
|---|---|
| `DeepResearchTaskEntity` | `DigestTask` |
| `DeepResearchPlanStep` | `PlanStep` |
| `ChatterService` | Vercel AI SDK `generateText` |
| `PromptManagerService` | 同名，简化版 |
| Plan → Execute → Thoughts → Evaluate → Report | Plan → Execute → Evaluate → Compose → Commit |
| LangGraph StateGraph + Annotation | 同 |
| Zod schema 强校验 LLM 输出 | 同 |
| Retrieved Context（KB 片段） | Findings（RSS items） |
| `[@#CIT N]` 引用 | `[CIT N]` 引用 |
| 2500+ 字长报告 | 400-600 字短报告 |
| 用户 query 驱动 | cron + 事项 prompt 驱动 |
