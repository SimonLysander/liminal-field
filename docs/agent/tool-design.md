---
name: designing-agent-tools
description: Use when designing tools for LLM agents (Vercel AI SDK / Anthropic tool_use / OpenAI function calling). Triggers include "design tools for this agent", "what tools should X have", "this tool feels off / too thin / too thick", "agent keeps misusing this tool".
---

# Designing Agent Tools

工具设计的全部规则,可以收敛成 **4 条核心原则**。下面所有的流程、技巧、契约、踩坑,都是这 4 条的下游——记住这 4 条,剩下的能自己推出来。

---

## 一、四条核心原则

判定一条原则够不够「核心」,标准是两点:**① 不可再推导**(导不出来,是个独立的立场或轴);**② 能生出别的规则**(其它做法是它的应用)。按这把尺子,只有 4 条:

### ① 从任务设计,本质是设计一套「动作系统」

工具存在的理由是「**帮 agent 做成一件事**」,不是「暴露一个查询接口 / 包装一层 API」。

从任务出发拆动作,拆出来的不是孤立工具,而是一套**会互相衔接的动作系统**——上一个动作的返回喂给下一个动作、用会话级 ref 串联。所以「工具之间怎么组合」不是另一个轴,它内蕴在「从任务设计」里。

> 不可推导:这是设计的**起点和朝向**。「5 步法」就是它的操作化。
> 下游:外粗内细、一次给够、返回画像、勿增旋钮。

```
✗ 数据库思维:list_memories + read_memory + write_memory + delete_memory
✓ 任务思维:remember("用户不喜欢表格") → 系统内部自动分类/去重/合并
```

### ② 给准确信息,不替它做判断

工具给**真实的事实**,决策留给模型。两层含义,缺一不可:

- **准确**:如实反映发生了什么——失败就说失败,截断就说截断,绝不返回 `available:false` 掩盖一次报错。给不真实的信息 = 没做到「准确」。
- **不替判断**:你一旦在工具里替它想「下一步该干嘛」,就把 LLM 退化成了执行器——那不如直接写工作流。

> 不可推导:这是工具和模型之间的**分工边界**。
> 下游:返回事实非指令、错误说「为什么+现状」不说「怎么办」、五条边角铁律。

### ③ 透明

模型在**调用前**就得知道:这工具会做什么、范围多大、按什么逻辑做。不能把决策藏在内部,让它调完才知道发生了啥。

> 不可推导:这是个时机约束——「调用前可知」。透明是**要求**(必须让它知道);怎么把这件事写好,是 ④ 的事。
> 下游:调用前能判断「这工具够不够支撑我的任务」。

### ④ 工具表面即 prompt

工具的**名字、description、参数、返回、示例**——模型读到的每个字都进上下文,**它们就是 prompt**。所以要用提示工程的方式来塑造,而不是用代码契约硬管:

- **示例 > 规则/枚举**:别用枚举字段去「管」行为(你保证不了模型填对),用 description 里的好坏示例去「教」它。
- **措辞即行为**:改几个字的措辞、换个更准的工具名,就能显著改变模型怎么用它。
- **上下文是预算**:返回要 token 经济,给消化过的画像,别拿原始 dump 撑爆它的注意力。

> 不可推导:前 3 条管「该传递什么」,④ 管「这些全是 prompt,得按提示工程塑造」——还多管一个别人不管的维度:token 经济。
> 下游:description 是教程、命名显而易见、示例非枚举、画像非 dump。

---

## 二、设计流程:5 步法

这是核心 ① 的操作化——从任务一路推到工具。顺序不能乱,每一步是下一步的前提。这套流程是**三轮失败逼出来的**(API 薄壳 → 从源出发包装 → 都被否),最后定的是「动作驱动」而非「API 包装」。

### Step 1:写清楚「达到什么效果」

不写 agent 做什么、用什么手段——写**做完之后达到的状态**。

**判断标准**:写完一句话,能不能说出「成功长什么样」。

- ❌ "做一个智能餐饮助手" —— 含糊,说不出成功状态
- ✓ "用户收件箱里,未读邮件被分类归档:重要的留 inbox 标星,账单/订阅/工作/个人归对应文件夹,广告归垃圾" —— 能说出成功状态

### Step 2:拆动作

从「**人/LLM 做这件事会做哪几步**」想,不是「我有什么 API」想。

**判断标准**:列出来的动作并集 = Step 1 的效果。

- ✓ "看收件箱有什么 / 看一封邮件 / 处理一封(标星 归档 删除)" —— 3 个动作并集 = 收件箱整理完
- ❌ "调 IMAP / 查数据库 / 触发 Webhook" —— 是实现层,跑偏了

### Step 3:每个动作怎么做?要哪些参数?

**先想「怎么做」**——想象人/LLM 完成这个动作的过程。**再列「参数」**——做的过程中**必须知道什么信息** = 参数。

参数不是「我设计要传啥」,是**做这件事本身需要什么**。每个必填参数都要能回答:**agent 在调用那一刻能合理知道吗?** 来源只有 3 种:

1. **用户对话/任务描述里有**(agent 从输入语境读到)
2. **上一步工具返回里给的**(agent 在对话流里看到了)
3. **系统注入的隐式 context**(agent 看不到,但系统帮它填)

任何一个必填参数不属于这 3 种 → agent 会瞎编 → 设计有问题。

> 举例(动作"看一封邮件"):它必须知道「是哪封」→ 参数 `emailId`。emailId 哪来?上一步 `list_unread` 返回里给的(来源 ②)——不是让 agent 编 ID,这是合法 ID 用法。

### Step 4:返回什么、异常怎么报

**核心:返回事实,不返回指令。异常说为什么,不说该做什么。**(这是核心 ② 的直接落地)

**判断标准**:返回里没有任何 `next_action / suggestion / 建议重试` 字段。

✓ 事实式:`{ subject, from, body, isRead }` / `{ errorCode: "EMAIL_NOT_FOUND" }`
❌ 指令式:`{ next_action: "reauth" }` / `{ message: "建议先 list_inbox 重新拿 emailId" }`

还要**诚实**:只返回这个动作能拿到的事实,不为"方便 LLM"硬塞虚构字段。

- ✓ "查空位"返回 `{ available: false }`
- ❌ `{ available: false, alternativeSlots: [...] }` —— 邻近时间是另一个动作的事,工具不能替 LLM 想"它接下来可能想问啥"

### Step 5:反馈展示(前端 or 日志)

工具调用是个**可观测事件**——人要能看到 agent 做了什么。按场景分两种渲染目标,**用同一份 `summary + meta` 数据**,只是输出靶子不同:

| agent 类型 | 渲染到哪 |
|---|---|
| 聊天类(Aurora,用户在场) | 前端 ToolCallCard,实时看 |
| 后台/cron 类(digest,无人在场) | 结构化日志 + 状态表,事后审计 |

**聊天类 · ToolCallCard**(克制可视化,别 dump 整坨 JSON):

```
[图标] [工具名] · [一行 summary]        ← 工具返回的 summary 直接拿出来
  ⎿ 第 1 条预览 …(最多 5 条)            ← meta.list[]
    还有 12 个                          ← 超 5 条用"还有 N 个"概括
```

- summary 是人话、不含内部 ID(出现 `src_xxx` = 把内部物泄漏给用户)
- 只有「碰了一组东西」的工具(search/list)才挂 `meta.list`;看一封/处理一封(read/handle)不挂

**后台/cron 类 · 结构化日志**:`summary` → 一行人话(grep 用);`meta.*` → 结构化 fields(Datadog/ELK 聚合用);错误同样打 `status=error errorCode=... reason=...`。判断标准:日志能不能让运维**事后还原** agent 的决策路径。

---

## 三、完整示例:整理收件箱 agent

按 5 步从零走一遍。

**Step 1 · 效果**:未读邮件经处理后,重要的留 inbox 标星;账单/订阅/工作/个人各归文件夹;广告归垃圾。

**Step 2 · 动作**:① 看收件箱有什么 → ② 看一封邮件内容 → ③ 处理一封(标星/归档/删除)。并集 = 效果。✓

**Step 3 · 参数**:

```
list_unread({ limit?, folder? })                    // 都 optional,默认 inbox 未读
read_email({ emailId })                             // emailId 来自 list_unread 返回
handle_email({ emailId, action, folder? })          // action='archive' 时 folder 必填
```

**Step 4 · 返回 + 异常**:

```
list_unread 成功 → { total:47, shown:47, items:[{emailId, from, subject, snippet}] }
            异常 → { errorCode:"MAILBOX_AUTH_EXPIRED" }
            注意:不返回 recommendation:"先处理紧急的"(优先级是 LLM 自己判)

read_email  成功 → { subject, from, body, isRead, attachmentsCount }
            异常 → { errorCode:"EMAIL_NOT_FOUND" }(拼错?已删?LLM 自己判)
            注意:不返回 category:"可能是账单"(分类是 LLM 看完内容做的判断)

handle_email 成功 → { done:true, action:'archive', folder:'bills' }(诚实说做了啥)
             异常 → { errorCode:"FOLDER_NOT_FOUND", folder:'bills' }(事实:名字错了)
             注意:不返回 suggestion:"试试 archive_bills"(LLM 看到错误自己会换名)
```

---

## 四、设计技巧(挂在 4 核心下游)

拆工具时随时对照。每条都标了它是哪条核心的应用。

### 核心 ① 从任务设计 → 下游

- **外层粗,内层细**:主 agent 的工具粗粒度、一步做成一件事;内部可以多步。`remember("…")` 对外一步,内部 Memory Agent `list→read→判断→write` 多步,主 agent 不关心。
- **一次给够**:返回的信息要让 agent 直接能决策,不必再调一次补上下文。`search` 返回 `{title, scope, wordCount, updatedAt, snippet}` 而非只给 `{id, title}`。(动作系统衔接的体现:省掉二次往返)
- **返回画像,不返回 dump**:返回**结构化的事实画像**,不是原始数据堆。`get_customer_context` 给一份客户全貌,不是把 3 张表的行倒给模型。
- **勿增旋钮**:agent 不该关心的参数别暴露。`collapse_hubs` 永远是"要折叠" → 那就别做成参数,内部写死。

### 核心 ② 给准确信息不替判断 → 下游

- **返回事实,不返回指令**:没有 `next_action/suggestion`。LLM 拿事实自己判下一步。
- **错误:说「为什么 + 现状」,不说「该怎么办」**:可操作性来自**上下文**,不来自**指令**。给够决策的原料,但不替它下结论。
  - ✗ "Error 404" / ✗ "建议用 Y 工具试试"(替它做判断)
  - ✓ "没找到标题为「量子计算」的记忆。当前记忆:[写作偏好、职业背景]"(给现状,它自己会换)
- **五条边角铁律**:见下「项目工具返回约定」——它们都是「准确/诚实」的硬化。

### 核心 ③ 透明 → 下游

- **调用前可判断**:description 写完,模型在调用前就能判断「这工具够不够支撑我的任务」。把逻辑藏在内部 = 不透明 = 模型没法判断够不够用。

### 核心 ④ 工具表面即 prompt → 下游

- **description 是教程,不是一句话**:写清什么场景用、什么场景不用、参数好坏示例、与其他工具的关系。在 JSON Schema 的 `examples` 给调用示例。微小的 description 改进能带来显著性能提升。
- **命名显而易见**:工具名即语义锚点。`get_current_draft / read_document_content / search_knowledge_base`,不是 `get_content / read_doc / search`。
- **用示例教,不用枚举管行为**:`source: "user_explicit"|"agent_inferred"` 这种你保证不了模型填对——用 description 里的示例教它什么时候记、怎么写。
- **token 经济**:返回别拿噪音撑爆上下文(和「返回画像非 dump」同源,从 prompt 成本角度看)。

---

## 五、工程轴:构建时穷尽,查询时直取

这条**不在接口设计轴上**——前面 4 核心讲「工具接口怎么跟模型对话」,这条讲「工具背后的数据/性能怎么做工程」,单列。

> **离线构建可以慢、可以穷尽;在线查询必须快且准。**

把重活挪到构建期(预计算、建索引、反范式化),让 agent 在线调用那一刻是直取。理由:agent 的每次工具调用都在它的推理链路上,慢一步拖累整条链;而构建是离线的,慢无所谓。

配套:**复杂工具/子系统,先调研业界范式再动手**(原最初想手写向量搜索式记忆,调研后发现"文件式 CRUD + LLM 判重"更简单)。功能明显有现成方案时不要什么都手写。

---

## 六、项目工具返回约定(实现契约)

本节是项目级实现契约,所有工具必须遵守。设计阶段用 5 步法推演,实现阶段按此契约落地代码。

### ToolResult 统一契约

所有工具的 `execute` 一律返回 JSON 字符串:

```ts
interface ToolResult {
  summary: string;          // 一行人类可读(前端直接显示;也给模型 TL;DR)
  detail?: string;          // 给模型的主体内容(正文/命中列表/结论),纯文本
  meta?: {
    status?: 'ok' | 'partial' | 'not_found' | 'ambiguous' | 'error';
    total?: number;         // 命中/条目总数
    shown?: number;         // 本次给了多少
    hasMore?: boolean;
    nextOffset?: number;    // 续取用
    list?: string[];        // 命中/候选标题(给前端 NestedList)
    [k: string]: unknown;   // 工具特定字段
  };
}
```

**三字段分工**:模型读整个 JSON(据 meta 决定续取/重试);前端 `ToolCallCard` 只取 `summary` 展示、按 `meta.status` 加极简标记(不解析文本、不算统计、不拼 ID);summary 必须人话不含内部 ID,ID 放 `meta`。非 JSON 旧返回 → 前端回退显示原文首行(迁移期兼容)。

### 五条边角铁律(核心 ② 的硬化)

1. **不静默丢**:截断/超量 → 必给 `total + hasMore + nextOffset`,让 agent 能续取。
2. **不静默失败**:找不到/没改成 → `status:'not_found'` + 明确 summary,绝不假装成功。
3. **歧义不瞎猜**:匹配到多条 → `status:'ambiguous'` + 候选列表,**不执行破坏性操作**。
4. **不完整要标记**:达步数/超时 → `status:'partial'`,summary 写明"结论可能不全"。
5. **不泄漏内部物**:summary 里不出现原始 ID/类型方括号;ID 放 `meta`(给模型续用)。

---

## 七、踩坑沉淀

1. **不要用枚举字段代替提示词**(核心 ④):`source: "user_explicit"|"agent_inferred"` 你保证不了模型填对,填错后系统拿着错误分类继续跑,比没有更危险。好的 description + 示例比枚举字段可靠。

2. **`generateObject` 不是 agent**:一次性输出 JSON 是函数调用。真 agent 有工具集、能多步、能看完已有数据再决策(list→read→判断→write)。某个"agent"只做一次结构化输出 → 它不需要 agent 形式,简化成函数调用,或给它真工具让它多步跑。

3. **数据类型以「加载策略」分,不以内容语义分**:最初设 4 种记忆类型,每次写入都要额外判断、边界还模糊。砍到 2 种,区分轴不是"内容是什么"而是"加载策略"——全文注入 vs 只注入标题索引。设计数据类型先问"谁用、何时加载、怎么用"。

4. **不要把业务概念混入基础设施**:记忆系统里不该有内容 ID/分区;session key 应是不透明字符串,业务层决定语义。把业务硬编进基础设施,会在多场景复用时制造耦合。

5. **复杂工具/子系统先调研再写**:见「工程轴」。

6. **主 agent 工具保持粗粒度,细节交给专职子 agent**(核心 ①):主 agent 的 `remember` 只收一个 `content`,分类/去重/合并全由 Memory Agent 内部决策。主 agent 工具越来越细(传越来越多字段)= 子 agent 职责向上溢出,工具退化成内部实现的映射。

---

## 八、自检

写完每个工具,问自己 5 个问题(对应 4 核心):

1. **透明(③)**:description 写完,LLM 调用前能不能看懂"这工具干啥、范围多大、用什么逻辑"?
2. **参数(①)**:每个必填参数都来自合法 3 来源(任务描述/上一步返回/系统注入)吗?
3. **返回(②)**:里面有没有 `next_action/suggestion/建议 X`?有 → 改成事实。
4. **异常(②)**:错误是"为什么挂了",还是"该怎么办"?后者 → 改成前者(给现状,不给指令)。
5. **prompt(④)**:名字/description 是不是按"教模型"写的?有没有用枚举字段硬管行为(该用示例)?summary 是不是人话不含内部 ID?
