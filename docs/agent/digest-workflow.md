# 简报工作流设计(Digest)

> 简报 = AI 撰稿人产出的一份「刊物」。一句话定位:**让 AI 抓来的资讯,配得上跟人手写的文章放在同一套展示语言里**——所以全程死磕一手原文、引用角标、报刊风排版,而不是糊一个「AI 摘要链接列表」。
>
> 这份文档只记**设计决策与理由**。节点的具体 schema/签名见代码(`server/src/modules/digest/`),结构图见 `docs/figures/digest-workflow.excalidraw`、版面解剖见 `docs/figures/newspaper-anatomy.excalidraw`。

## 1. 三节点骨架

```
react_agent  →  compose  →  commit
（找料+读原文）  （成稿）     （落库）
```

整体仍是 ReAct loop,用 Vercel AI SDK 内置的 `stepCountIs` 兜底循环,**不引 LangGraph**——三节点编排在 NestJS service 里手写足够。骨架没变,变的是每个节点内部的关键设计,下面逐条讲「为什么这么定」。

## 2. 关键设计决策(本轮重构的核心)

### 2.1 工具:从 6 个专属工具 → 4 个共享工具

旧设计给简报造了一套专属工具(`list_sources`/`fetch_source`/`search_source`/`read_item_full`/`get_recent_picks`/`save_finding`)。现在 react_agent **复用主 agent 的工具底座**(`ToolAssembler`),只用 `browse` / `web_search` / `web_fetch` / `pick` 四个。

**为什么:** 简报研究员和 Aurora 干的是同一件事——浏览、搜索、抓取、挑选。维护两套语义重叠的工具是负债。统一到一套工具底座后,工具的设计纪律、ToolResult 契约、前端 ToolCallCard 渲染全部复用。`DigestToolsFactory` 已删。

### 2.2 一手原文链路(fulltext):简报的命根子

这是整个模块的灵魂设计。`pick` 进 findings 的条目,不只是存 RSS 给的二手 `snippet`,而是带上**真正抓回来的网页全文**。

链路:`web_fetch` 抓正文时,在 react-agent 的 `onStepFinish` 钩子里把 `url → fulltext` 留存到上下文 → `pick` 时按 url 关联,把 fulltext 写进 `Finding.fulltext` → compose 基于原文成稿。

**为什么:** 二手 snippet 只够「列个链接」,写不出有事实密度的简报。要让 AI 撰稿人配得上人,它必须读过原文。这是「简报 ≠ 资讯聚合器」的技术分界线。

### 2.3 compose:从「一次性 LLM」→ plan → write → assemble 三阶段

旧设计是把所有 findings 一次性喂进一个 prompt、让 LLM 一把生成整篇。**线上实测:findings 一多(20 篇 / 47k tokens)就因超长输出崩溃,简报全失败。**

现在拆成三阶段(分而治之):
1. **plan** — 只喂每条 finding 的 `title + reason`(不喂 fulltext,小 JSON),让 LLM 分主题、定刊头(headline)和导语(deck)。输出小、稳。
2. **write** — 按主题**并行**写,每个主题只喂它自己那几条的 fulltext,产出该节 markdown。单节失败被 try/catch 隔离,不拖垮整篇。
3. **assemble** — **纯代码**拼接(`## 标题 + 正文`),不再过 LLM。

**为什么:** 大模型「单次输出」长度是硬瓶颈,且「JSON 包裹 markdown」的格式本身脆。拆成「规划用小调用、写作按主题切分、拼装交给代码」后,既绕开输出上限,又让单点失败可隔离。这是典型的「大任务拆分、流式/分片处理」防御。

> 补充:plan 阶段没覆盖到的 findings 兜底归入「其他」一节,不丢料。

### 2.4 报告:每次运行独立存储,不 upsert 覆盖

旧设计按 `periodKey` upsert——同一期重复运行会**硬覆盖**掉上一份报告及其链路。已废弃。现在每次运行 `create` 一份**独立** `DigestReport`,历史全留。

**为什么:** 两次运行是两次独立的创作,凭什么指向同一份、互相覆盖?报告占不了多少磁盘,历史该留。展示端要「每期只显示最新一份」是**展示层**的去重职责(`latestPerPeriod`),不该靠存储层删数据来实现。

### 2.5 commit:写独立 `DigestReport` entity,不混进通用内容树

commit 节点不再走 `ContentService` / `NavigationService` 建 ContentSnapshot + NavigationNode,而是直接写独立的 `digest_reports` 集合。

**为什么:** 简报是独立产品线,有自己的生命周期(可单独删、按事项归并)。塞进通用内容树会让两套语义互相牵制。独立 entity 后,删报告 → 级联清 task 引用(`clearReportRef`)这种简报特有的链路才干净。

### 2.6 keywords:正则匹配,全量拉取后本地过滤

各信息源的服务端 query 能力参差(arxiv 的 `ti:` 跟 RSS 的全文过滤根本不是一回事),且子串匹配会误中(`rust`→`t**rust**`、`AI` 泛滥)、漏报中文。现在统一为:**全量拉取 → 本地正则匹配**(`keyword-match.util.ts`,`iu` flag,非法正则降级为字面量)。

**为什么:** 把「匹配」这件事从「依赖各源服务端」收归本地统一实现,语义才一致可控。代价是拉取量变大——这是权衡过的:可接受的抓取量换确定性的匹配质量,但要守住单源 fetchSize 上限,别把全量拉取变成对人家站点的 DDoS。

### 2.7 可观测:DigestTask.steps 边跑边写

react_agent 每调一步工具,`onStepFinish` 就 append 一条 `AgentStep`(toolName/args/summary/meta/durationMs)到 `DigestTask.steps`。

**为什么:** Agent 长链路必须可见,排错靠看不靠猜。append-only 边跑边写意味着——哪怕跑到一半挂了,也能在前端看到它已经走到哪一步、每步抓了什么。

## 3. 展示侧设计原则:报刊风「只改字号」

简报的展示端复用文章的展示组件,视觉差异**只通过字号层级 + 引用角标**体现,**绝不加装饰**(✦ 分隔符 / 首字下沉 / 居中 / 斜体 pull-quote 一律不要)。引用就近标 `[@#CIT N]`,前端渲染成角标。

**为什么:** 「报刊感」来自信息层级的克制经营,不是来自装饰元素。加装饰只会让它显得廉价、和站点既有的克制审美打架。这条和设计宪法(`docs/design-system/language.md`)同源:克制。

## 4. 数据模型(指针)

字段定义见代码,这里只点设计要点:
- `DigestTask`(`digest-task.entity.ts`)— 运行状态机 + `findings[]`(含 `fulltext?`)+ `steps[]`(可观测)。`Finding.snippet` 为可选(arxiv 等源可能没有,必填会卡 create 校验)。
- `DigestReport`(`digest-report.entity.ts`)— 独立报告,含 `headline` / `deck` / markdown。索引按 `(topicId, publishedAt)`,`periodKey` **不再唯一**。

## 5. 一句话总结

这轮重构的设计主线只有一条:**把简报从「一次性糊一篇」升级成「读原文 → 分主题写 → 独立留档」的可靠出版流程**——可靠性(三阶段防崩、单点隔离、步骤可观测)、一手性(fulltext 链路)、历史完整性(不覆盖)、和人写内容的视觉平权(报刊风克制),四者缺一不可。
