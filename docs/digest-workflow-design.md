# 智能采集工作流设计 (task #36 / #37)

> 「精选」公开端读到的每份报告，背后的产出管线。这份文档定义工作流的数据模型、执行逻辑、AI 调用规约、错误兜底，以及产品差异化的「**事项级内容指标**」机制。

## 1. 设计原则

1. **每事项独立 cron job**——精确按用户配的节奏跑，不轮询
2. **失败隔离**——单源失败不阻塞事项，单事项失败不影响其他事项
3. **AI 调用合并**——批量判定 + 历史去重 + 结构化提取**一次 LLM 调用**搞定，省 token、省时延
4. **状态可观测**——每步执行进展写表，前端可看 / 用户可手动重试
5. **业务流复用现有基建**——报告入库走 ContentService.saveContent + NavigationNode，跟笔记 / 文集同一套 Git 版本管理

## 2. 总体数据流

```
┌─ cron 触发（每事项独立 job） ──────────────────────────────┐

  1. 装载 SmartTopicConfig（cron / sourceIds / keywords /
                            prompt / extractFields）
                ↓
  2. 并发拉所有订阅 source 的 RSS（rss-parser）
        └→ 写 InfoSource.lastFetchStatus（成败）
        └→ 单源失败：log + continue，不阻塞其他源
                ↓
  3. 抽 RSS items → 按 itemGuid 查 ProcessedFeedItem 去重
                ↓
  4. 关键词预筛（事项有 keywords 才筛；无 keywords 跳过这步）
                ↓
  5. 批量 AI 调用 #1【判定 + 评分 + 结构化提取】
        输入：事项描述 + 用户 prompt + 最近 3 期已推过的标题
              + 候选条目列表（标题/源/摘要）+ extractFields schema
        输出：JSON 数组，每条
              { idx, relevant, duplicate,
                quality, importance, confidence,
                extracted: { ...事项定制字段 },
                summary: string, reason: string }
                ↓
  6. 筛 relevant && !duplicate → 按 quality × importance 排序 →
     取 Top N（N 由事项配置或默认 10）
                ↓
  7. AI 调用 #2【写导语 + 期末总结】
        输入：Top N 的标题 + 摘要 + 抽出来的结构化字段聚合
        输出：本期 headline / lead 导语段 / closing 期末总结
                ↓
  8. 拼装 markdown 报告
        frontmatter（期号 / 日期 / 命中数 / avgQuality /
                    sourceCount / 各 extractField 聚合统计）
        body（导语 → picks 数组（每条标题/源/摘要/结构化卡片）
              → 期末总结）
                ↓
  9. 入库
        - contentService.createContent（创报告 ContentItem ci_xxx）
        - navigationRepository.create（NavigationNode,
              scope=digest, parentId=事项节点, contentItemId=ci_xxx,
              name="第 N 期 · 2026-06-20"）
        - contentService.saveContent（commit, action=commit）—— 走
              Git 异步归档
        - 批量写 ProcessedFeedItem（每条候选都写一条，标记 picked /
              quality / extracted 等）
        - SmartTopicConfig.updateRunState（lastRunAt, lastRunStatus
              =ok, lastRunHits=N）
                ↓
  10. 任何一步 throw → 顶层 catch + log（含 traceId）+
        SmartTopicConfig.updateRunState(failed, errMsg)
        不自动重试 —— 用户手动 retry 或等下次 cron
```

## 3. 核心差异化：事项级 extractFields（结构化指标）

这是「精选」对比通用 RSS reader 的最大产品差异化。

### 配置层

`SmartTopicConfig.extractFields: ExtractField[]`

```ts
interface ExtractField {
  key: string;              // 字段 key，如 'venue'，作为 markdown frontmatter 的字段名
  label: string;            // 显示名，如 '举办地点'
  type: 'string' | 'date' | 'number' | 'enum' | 'list';
  description: string;      // 给 AI 的提示，如"这条新闻提到的活动地点"
  enum?: string[];          // type=enum 时的可选值
  required?: boolean;       // false 时 AI 可以返回 null（找不到就找不到，不强行编）
  extractionMode: 'ai' | 'regex';
  regex?: string;           // type=regex 时
}
```

举例配置：

```ts
// 事项「摄影活动举办」
extractFields = [
  { key: 'venue', label: '举办地点', type: 'string',
    description: '该活动的举办城市 / 场馆，找不到返回 null',
    extractionMode: 'ai' },
  { key: 'eventDate', label: '活动日期', type: 'date',
    description: '活动的开始日期（ISO 8601），延期/未定返回 null',
    extractionMode: 'ai' },
  { key: 'organizer', label: '主办方', type: 'string',
    description: '主办单位的全称',
    extractionMode: 'ai' },
  { key: 'entryFee', label: '报名费', type: 'string',
    description: '具体金额 / 免费 / 未明示',
    extractionMode: 'ai' },
]

// 事项「AI 应用发展」
extractFields = [
  { key: 'vendor', label: '厂商', type: 'enum',
    enum: ['Anthropic', 'OpenAI', 'Google', 'Meta', 'Mistral', '其他'],
    description: '该新闻主要涉及的 AI 厂商',
    extractionMode: 'ai' },
  { key: 'modelVersion', label: '模型版本', type: 'string',
    description: '提到的具体模型版本号，如 Claude 4.7 / GPT-5',
    extractionMode: 'ai' },
  { key: 'scenario', label: '应用场景', type: 'enum',
    enum: ['编程', '写作', '研究', '商业', '娱乐', '其他'],
    description: '该新闻关注的 AI 应用场景',
    extractionMode: 'ai' },
  { key: 'sentiment', label: '情绪', type: 'enum',
    enum: ['正面', '中性', '负面'],
    description: '业界对此事的整体反馈情绪',
    extractionMode: 'ai' },
]
```

### AI 调用层

Prompt 里附 extractFields schema，模型返回时每条 pick 带 `extracted` 子对象。

### 报告呈现层

每条精选下方显示结构化卡片（前端组件，**task #36 不做前端**，task #36 只生成 markdown frontmatter，前端展示放后续 task）：

```
1. 「上海双年展 2026 主题摄影征件公告」
   来源：少数派 · 6 月 18 日

   摘要正文...

   ┌──────────────────────────┐
   │ 📍 地点  上海当代艺术博物馆 │
   │ 📅 日期  2026-08-15 开展   │
   │ 🏛 主办  上海双年展组委会  │
   │ 💵 报名  免费             │
   └──────────────────────────┘
```

### 报告聚合层

报告 frontmatter 加 extractField 维度的聚合统计：

```yaml
issueNumber: 12
date: 2026-06-20
hitCount: 5
avgQuality: 4.2
sourceCount: 3
extractAggregates:
  vendor:
    Anthropic: 3
    OpenAI: 2
  scenario:
    编程: 3
    写作: 2
```

这给用户提供"本期主要在讨论哪个厂商 / 哪个场景" 的鸟瞰。

## 4. 数据模型

### 4.1 新增表：ProcessedFeedItem

```ts
@modelOptions({
  schemaOptions: { collection: 'processed_feed_items' },
  options: { allowMixed: Severity.ALLOW },
})
export class ProcessedFeedItem {
  @prop({ required: true, trim: true })
  _id!: string;                    // pfi_xxx 业务 id

  @prop({ required: true, trim: true, index: true })
  topicId!: string;                // 事项 ContentItem.id

  @prop({ required: true, trim: true })
  itemGuid!: string;               // RSS item guid / 退化用 url

  @prop({ required: true, trim: true })
  sourceId!: string;               // InfoSource._id

  @prop({ trim: true })
  title?: string;

  @prop({ trim: true })
  url?: string;

  @prop({ trim: true })
  reportContentItemId?: string;    // 若被命中入了某期报告，关联报告 ci_xxx

  @prop({ required: true, default: false })
  picked!: boolean;                // 本次跑命中没

  @prop({ type: () => Number })
  quality?: number;                // 1-5 AI 评分

  @prop({ type: () => Number })
  importance?: number;             // 1-5

  @prop({ type: () => Number })
  confidence?: number;             // 0-1

  @prop({ type: () => Object })
  extracted?: Record<string, unknown>;  // 事项 extractFields 的提取结果

  @prop({ trim: true })
  reason?: string;                 // AI 判定理由 / debug

  @prop({ required: true, type: () => Date })
  processedAt!: Date;
}

// 索引
@index({ topicId: 1, itemGuid: 1 }, { unique: true })   // 去重核心索引
@index({ topicId: 1, processedAt: -1 })                  // 历史查询
```

**说明**：
- `topicId + itemGuid` 唯一索引——同事项内 guid 不重，跨事项允许同 guid
- 没命中的也写一条（picked=false）——为了下次跑时已知"判过 不相关"，跳过重复 AI 调用
- `extracted` 用 Mixed schema，因为 extractFields 是事项级配置，跨事项 schema 不固定

### 4.2 SmartTopicConfig 扩字段

新增 `extractFields: ExtractField[]`（同上结构）+ `topN?: number`（每期取 Top 几条，默认 10）。

### 4.3 报告（ContentSnapshot）

不改 entity，markdown frontmatter 里塞工作流元数据：

```yaml
---
kind: digest-report
topicId: ci_xxxx
issueNumber: 12
date: 2026-06-20
hitCount: 5
candidateCount: 47
avgQuality: 4.2
avgImportance: 3.8
sourceCount: 3
sources: [src_aaa, src_bbb, src_ccc]
extractAggregates: { ... }
---

（导语正文）

## 1. 第一条标题

[来源] · [extractField 卡片]

（picks 摘要）

---

（期末总结）
```

frontmatter 解析复用 anthology 的 yaml frontmatter 工具（看 `server/src/modules/workspace/anthology-view.service.ts` 顶部 yaml.load 用法）。

## 5. 模块拆解

```
server/src/modules/digest/workflow/
├── digest-scheduler.service.ts          # task #37：cron 注册器
├── digest-workflow.service.ts           # 核心管线编排（10 步）
├── fetchers/
│   ├── fetcher.interface.ts             # SourceFetcher 接口
│   ├── rss-fetcher.service.ts           # RSS / Atom 实现（首期）
│   └── (future: webpage-fetcher / api-fetcher / mailbox-fetcher)
├── ai-judge.service.ts                  # 批量 AI 调用 #1（判定+提取）
├── ai-compose.service.ts                # AI 调用 #2（写导语+总结）
├── report-builder.service.ts            # 拼装 markdown
└── processed-feed-item.repository.ts    # ProcessedFeedItem CRUD
```

### 5.1 SourceFetcher 接口（多 type 扩展点）

```ts
export interface FetchedItem {
  guid: string;       // 唯一 id（RSS guid，缺失用 url，url 也缺就跳过）
  title: string;
  url?: string;
  snippet?: string;   // 简述/摘要
  rawContent?: string; // 全文（如果 source 提供）
  publishedAt?: Date;
}

export interface SourceFetcher {
  readonly type: InfoSourceType;
  fetch(config: Record<string, unknown>): Promise<FetchedItem[]>;
}
```

首期实现 `RssFetcher`（`rss-parser` 库）；未来加 `WebpageFetcher` / `ApiFetcher` 只需 implements 接口。

### 5.2 AiJudgeService

#### 5.2.1 Prompt 模板（核心）

```
你是「{事项名}」专栏的内容编辑。任务：从候选条目中筛出与事项相关、且
未在历史中出现过的，并提取结构化字段。

事项关注点：{事项 prompt（用户写的）}

最近 3 期已推过的标题（避免重复）：
- {历史标题 1}
- {历史标题 2}
- ...

候选条目（每条标 idx）：
[1] 标题：xxx
    来源：xxx
    摘要：xxx
[2] ...

提取字段 schema（每条 pick 都要提取）：
- {key}: {type} · {description}{若 enum：枚举值 [...]}
- ...

请返回 JSON 数组，每条候选一个对象：
{
  idx: 数字,
  relevant: bool,              // 跟事项相关吗
  duplicate: bool,             // 跟历史 3 期重复吗（语义级）
  quality: 1-5,                // 内容质量
  importance: 1-5,             // 对事项的信号强度
  confidence: 0-1,             // 你对 relevant 判断的把握
  extracted: { ...字段提取 },  // 找不到的字段返回 null，不要瞎编
  summary: "60-120 字的中文摘要，给报告读者看",
  reason: "30 字内为什么 relevant/duplicate（debug 用）"
}

只输出 JSON 数组，不要额外文字。
```

#### 5.2.2 调用 infra

复用项目现有的 AI provider 机制（看 `server/src/modules/agent/` 怎么用 settings 里的 provider）。需要找一个**非 agent loop** 的直接 LLM 调用入口（agent loop 太重）。如果没有现成的"裸 LLM 调用"接口，**task #36 实施前需要先调研**：

- 选项 A：直接用 `@anthropic-ai/sdk` 调 Claude API，从 SystemConfig.aiProviders 里取 key/baseUrl/model
- 选项 B：复用 agent loop 但用一个"无工具、无 skill"的 agent kind 跑一次对话

倾向 A——更直接、更可控、易测试。

### 5.3 AiComposeService

调用 #2 写导语 + 总结：

```
你是「{事项名}」专栏的主编。下面是本期编辑选出的 N 条精选，写一段
导语（60-100 字）和一段期末总结（80-120 字）。

风格：克制、有判断、不水。报纸社论的味道，不要"科技博主"语气。

精选列表：
1. {标题}
   摘要：{summary}
   {结构化字段聚合}：vendor=Anthropic, scenario=编程
2. ...

输出 JSON：
{
  headline: "本期标题（一句话，15-25 字）",
  lead: "导语段落",
  closing: "期末总结段落"
}
```

### 5.4 ReportBuilderService

把所有数据拼装成报告 markdown，前端 PlateReadOnly 渲染。

## 6. AI 调用层细节

### 6.1 模型选型

倾向 **Claude 4.7（或当前最强 Sonnet）**——
- 调用 #1（判定+提取）需要 JSON 输出稳定 + 结构化能力 → Claude 优秀
- 调用 #2（写稿）需要中文写作品味 → 同上
- 项目本身用 Anthropic SDK 有先例

### 6.2 上下文预算（粗算）

每次 cron job 一个事项：
- 调用 #1：~3000-8000 input tokens（候选 50 条 × 100 tokens + history + prompt）, ~2000-4000 output（每条 ~100 tokens × 50）
- 调用 #2：~2000 input + ~500 output

每事项一次跑 ~$0.05-0.15（Claude Sonnet 价格）。每天若 10 个事项各跑 1 次 → ~$1/天 → 月 $30。可承受。

### 6.3 失败重试

- AI 调用失败（网络 / 5xx / JSON parse 失败）：**单次重试**，仍失败放弃
- JSON schema 不符（缺字段 / 类型错）：报告失败状态，不入库
- 通过 token usage 限流：如果用户 .env 里配了 `DIGEST_MAX_TOKENS_PER_RUN`，超额停止

## 7. 执行模型（task #37 的范围）

### 7.1 DigestSchedulerService

```ts
@Injectable()
export class DigestSchedulerService implements OnModuleInit {
  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly topicConfigRepo: SmartTopicConfigRepository,
    private readonly workflow: DigestWorkflowService,
  ) {}

  async onModuleInit() {
    // 启动时遍历所有启用的事项，注册 cron
    const configs = await this.topicConfigRepo.findEnabled();
    for (const config of configs) {
      this.register(config);
    }
  }

  register(config: SmartTopicConfig) {
    const job = new CronJob(config.cron, () =>
      this.workflow.runOnce(config.contentItemId)
    );
    this.registry.addCronJob(this.jobNameOf(config), job);
    job.start();
  }

  unregister(contentItemId: string) {
    const name = `digest:${contentItemId}`;
    if (this.registry.getCronJobs().has(name)) {
      this.registry.deleteCronJob(name);
    }
  }

  reschedule(config: SmartTopicConfig) {
    this.unregister(config.contentItemId);
    if (config.enabled) this.register(config);
  }

  private jobNameOf(c: SmartTopicConfig) {
    return `digest:${c.contentItemId}`;
  }
}
```

### 7.2 跟 TopicService 钩接

TopicService.create / update / delete 调 scheduler.register / reschedule / unregister。

## 8. 手动触发

UI 入口（已有事项详情页的「立即跑一次」按钮）：

`POST /digest/topics/:id/run-now` → 直接调 `workflow.runOnce(contentItemId)`，不经过 scheduler。

返回 `{ status: 'started', reportId?: string }`，进度由 SmartTopicConfig.lastRunStatus 反映（前端轮询）。

## 9. 错误处理 + 可观测性

### 9.1 traceId

每次 runOnce 生成一个 traceId（uuid），所有 log 携带，方便排错。

### 9.2 关键日志（NestJS Logger）

```ts
logger.log(`[digest] run started topic=${id} trace=${traceId}`);
logger.debug(`[digest] fetched ${items} items source=${srcId}`);
logger.log(`[digest] AI judge candidate=${n} duration=${ms}ms`);
logger.log(`[digest] picked ${m}/${n} avgQuality=${q.toFixed(1)}`);
logger.log(`[digest] report committed ci=${reportCi} trace=${traceId}`);
logger.error(`[digest] failed topic=${id} step=${step} trace=${traceId}`, err.stack);
```

### 9.3 状态前端可见

SmartTopicConfig.lastRunStatus（pending/running/done/failed）+ lastRunError，前端事项详情页显示。

## 10. 拆解为子任务

为了 task #36 不一次吃太大，建议分子任务（每个 1 commit）：

| 子任务 | 范围 | 测试 |
|---|---|---|
| **#36a** 数据层 | ProcessedFeedItem entity + repository + SmartTopicConfig 加 extractFields/topN + 数据迁移 | repository 单测 |
| **#36b** SourceFetcher + RssFetcher | rss-parser 依赖 + 接口 + 实现 | rss-parser fixture 单测 |
| **#36c** AiJudgeService | 直接 LLM 调用入口（用 Anthropic SDK 还是项目现有？先调研）+ prompt + JSON parse | 用 mock LLM 响应测 prompt 拼装 |
| **#36d** AiComposeService | LLM 调用 #2 + JSON parse | 同上 |
| **#36e** ReportBuilderService | 拼装 markdown + frontmatter | 单测 |
| **#36f** DigestWorkflowService | 10 步编排串起来 + 错误兜底 | 集成单测（mock fetcher/judge/compose） |
| **#36g** Controller + 手动触发 endpoint | POST /digest/topics/:id/run-now | controller 测 |
| **#36h** 前端事项详情页加 extractFields 配置 UI + 「立即跑一次」按钮 + 状态轮询 | DigestTopicForm 改 + DigestTab 状态显示 | 视觉对齐 |
| **#37** Scheduler + TopicService 钩接 | DigestSchedulerService + reschedule on update | scheduler 测 |

每个子任务跑一遍 7 步检查 + commit。这样推进可控、可回滚。

## 11. 不在 task #36 / #37 范围

- **前端报告渲染层**——把 frontmatter 里的 extracted 字段渲染成结构化卡片：这是后续 UI iteration，本工作流只产 markdown
- **多源全文抓取**（fetcher 补正文，而不只是 RSS 摘要）：RSS 摘要够 AI 判定；如果首期判定准确率不够，后期加
- **embedding 语义去重**（Q3 A 方案）：B 方案不够准时再加
- **用户互动指标**（追问次数 / 阅读时长 / 反馈按钮）：埋点 + UI 改造，单独 task

## 12. 待调研（实施前必做）

1. **项目内 LLM 调用 infra**：现有 agent loop 是不是有"裸调"入口？没有的话用 `@anthropic-ai/sdk` 起一个干净的 service
2. **provider 配置读取**：怎么从 SystemConfig 里拿 baseUrl / apiKey / model（看 `agent` module 里 `AgentLifecycleService` 怎么解析 provider）
3. **frontmatter 序列化工具**：anthology-view 里有 yaml.dump 用法，照搬
4. **rss-parser 库验证**：找 1-2 个真实 RSS feed 跑通解析；中文 source（少数派 / 阮一峰）的编码 / 标点别有坑

---

## 验收清单（task #36 完成的标志）

- [ ] 一个事项配好 sources / keywords / prompt / extractFields，手动调 `POST /digest/topics/:id/run-now`
- [ ] 后台 log 看到完整 10 步执行
- [ ] db 里能看到该期报告（ContentSnapshot 含完整 markdown + frontmatter）
- [ ] 报告下属 NavigationNode 创建成功（事项节点下 +1 子节点）
- [ ] 公开端 `/digest/:topicId` 列表里看到这期
- [ ] `/digest/:topicId/:reportId` 阅读页能渲染（虽然结构化卡片 UI 是后续 task）
- [ ] ProcessedFeedItem 表写入了所有候选 + 命中标记 + extracted 字段
- [ ] SmartTopicConfig.lastRunStatus = ok, lastRunAt 更新

## 验收清单（task #37 完成的标志）

- [ ] 启动时 SmartTopicConfig 启用的事项的 cron 都注册成功
- [ ] 改事项 cron 后 scheduler 重新注册新时间
- [ ] 删除事项 / 停用事项 → cron unregister
- [ ] 手动触发跟 cron 触发走同一条 workflow.runOnce 路径
- [ ] log 里看到「[digest] cron registered」类启动诊断行
