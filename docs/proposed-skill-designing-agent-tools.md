---
name: designing-agent-tools
description: Use when designing tools for LLM agents (Vercel AI SDK / Anthropic tool_use / OpenAI function calling). Triggers include "design tools for this agent", "what tools should X have", "this tool feels off / too thin / too thick", "agent keeps misusing this tool".
---

# Designing Agent Tools

## 两条核心

1. **给 LLM 准确信息，不替它做判断。** 替 LLM 想"下一步该做什么"等于把它退化成执行器——直接写工作流就好了，不需要 LLM。
2. **工具要透明。** LLM 在**调用前**就要知道这个工具会做什么、范围多大、按什么逻辑做——靠 description 写清楚，不能把决策藏在内部让 LLM 事后才知道。

## 5 步法

设计任何 agent 工具集，按这 5 步顺序走。

---

### Step 1：写清楚"达到什么效果"

不写 agent 做什么、用什么手段——写**做完之后达到的状态**。

**判断标准**：写完一句话，能不能说出"成功长什么样"。

- ❌ "做一个智能餐饮助手" —— 含糊，说不出成功状态
- ✓ "用户的收件箱里，未读邮件被分类归档，重要的留在 inbox 标星，账单/订阅/工作/个人归到对应文件夹，广告归垃圾" —— 能说出成功状态

效果写清楚 → 后面 3 步才能基于它推。

---

### Step 2：拆动作

从"**人/LLM 做这件事会做哪几步**"想，不是"我有什么 API"想。

**判断标准**：列出来的动作并集 = Step 1 的效果。

- ✓ "看收件箱有什么 / 看一封邮件 / 处理一封（标星 归档 删除）" —— 3 个动作并集 = 收件箱整理完
- ❌ "调 IMAP API / 查数据库 / 触发 Webhook" —— 是实现层，跑偏了

---

### Step 3：每个动作怎么做？要哪些参数？

**先想"怎么做"**——想象人/LLM 完成这个动作的过程是怎样的。
**再列"参数"**——做的过程中**必须知道什么信息** = 参数。

参数不是"我设计要传啥"，是**做这件事本身需要什么**。

每个必填参数都要能回答：**agent 在调用那一刻能合理知道吗？** 来源就 3 种：

1. **用户对话/任务描述里有**（agent 从输入语境读到）
2. **上一步工具返回里给的**（agent 在对话流里看到了）
3. **系统注入的隐式 context**（agent 看不到，但系统帮它填）

任何一个必填参数不属于这 3 种来源 → agent 会瞎编 → 设计有问题。

举例（动作"看一封邮件"）：

想象 LLM 要做"看某封邮件的完整内容"。它必须知道：**是哪封邮件**。

→ 1 个参数：`emailId`。

**emailId 哪来？** 上一步 `list_unread` 工具返回里给的——agent 在对话流里看到了"邮件 X 的 emailId 是 e1"。属于来源 ②。**不是让 agent 编一个 ID**——这是合法 ID 用法。

不要从"我能传什么"反推，从"这件事本身需要什么"正推。

---

### Step 4：返回什么、异常怎么报

**核心：返回事实，不返回指令。异常说为什么，不说该做什么。**

LLM 拿到事实**自己**判断下一步——这是 LLM 存在的意义。

**判断标准**：返回里没有任何 `next_action / suggestion / 建议重试` 这类字段。

举例（动作"看某封邮件"）：

✓ 正确（事实式）：
```
成功：{ subject, from, to, body, receivedAt, isRead }
错误：{ errorCode: "EMAIL_NOT_FOUND" }
错误：{ errorCode: "MAILBOX_AUTH_EXPIRED" }
```

❌ 错误（指令式）：
```
{ message: "建议先 list_inbox 重新拿 emailId" }
{ next_action: "reauth" }
```

LLM 看到 `EMAIL_NOT_FOUND` 自己判断是用户拼错了还是邮件被删了——不需要工具告诉它该怎么办。

**还要注意：诚实返回这个动作能拿到的事实，不为"方便 LLM"硬塞虚构字段。**

- ✓ "查空位"返回 `{ available: false }`
- ❌ "查空位"返回 `{ available: false, alternativeSlots: ["18:30","20:00"] }`
  —— 邻近时间是另一个动作的事，工具不能替 LLM 想"它接下来可能想问什么"

---

## 完整示例：整理收件箱 agent

按 4 步从零设计一遍。

### Step 1：效果

> 用户的未读邮件经过 agent 处理后，达到状态：重要的留在 inbox 并标星；账单/订阅/工作/个人各自归到对应文件夹；广告归到垃圾文件夹。

能说出成功状态：「点开收件箱，inbox 里只剩标星的重要邮件，其他都已分类归档」。

### Step 2：动作

人会怎么做？

1. **看收件箱里有什么** —— 拿候选列表
2. **看一封邮件的内容** —— 决定怎么处理前必须看内容
3. **处理一封**（标星 / 归档到 X 文件夹 / 删除）

并集 = 完成 Step 1 的效果。✓

### Step 3：每个动作的参数

**动作 1 · 看收件箱里有什么**

做这件事必须知道什么？严格说什么都不用——默认就是 inbox 文件夹的未读。

参数：全 optional
```
list_unread({ limit?, folder? })   // 默认 limit=50, folder='inbox'
```

**动作 2 · 看一封邮件**

做这件事必须知道：是哪封 → `emailId`

```
read_email({ emailId })
```

emailId 怎么来：从 Step 1 工具的返回里。

**动作 3 · 处理一封**

做这件事必须知道：哪封 + 做什么 + （归档时）归到哪

```
handle_email({
  emailId,
  action: 'star' | 'archive' | 'delete',
  folder?,            // action='archive' 时必填
})
```

### Step 4：返回 + 异常

**list_unread**

成功：
```
{
  total: 47,        // 未读总数
  shown: 47,        // 这次返了几条（如果 total 超 limit，shown < total）
  items: [
    { emailId, from, subject, snippet, receivedAt }
  ]
}
```

异常：
```
{ errorCode: "MAILBOX_AUTH_EXPIRED" }
```

注意：**不**返回 `recommendation: "先处理紧急的"`——优先级是 LLM 看完列表自己判断的。

**read_email**

成功：
```
{
  subject, from, to, body, receivedAt, isRead,
  attachmentsCount     // 事实：有几个附件
}
```

异常：
```
{ errorCode: "EMAIL_NOT_FOUND" }     // 可能用户拼错 / 邮件已删除——LLM 自己判
```

注意：**不**返回 `category: "可能是账单"`——分类是 LLM 看完内容自己做的判断，不是工具的事。

**handle_email**

成功：
```
{ done: true, action: 'archive', folder: 'bills' }   // 诚实说做了啥
```

异常：
```
{ errorCode: "EMAIL_NOT_FOUND" }
{ errorCode: "FOLDER_NOT_FOUND", folder: 'bills' }   // 事实：folder 名错了
{ errorCode: "PERMISSION_DENIED" }                    // 事实：没权限
```

注意：**不**返回 `suggestion: "试试 archive_bills 文件夹"`——LLM 看到 FOLDER_NOT_FOUND 自己会换一个名字试。

---

---

### Step 5：反馈展示（前端 or 日志）

工具调用是个**可观测事件**——人要能看到 agent 做了什么。
按场景分两种渲染目标：

| agent 类型 | 渲染到哪 |
|---|---|
| 聊天类（Aurora，用户在跟 agent 对话） | 前端 ToolCallCard，用户实时看 |
| 后台/cron 类（digest，没用户在场） | 结构化日志 + 状态表，给运维/事后审计看 |

**两种用的是同一份数据**（工具返回的 summary / meta）—— 只是输出靶子不同。

---

#### 聊天类：前端 ToolCallCard

前端不能 dump 整坨 JSON，要做**克制的可视化**。

**核心范式**（每次工具调用展示成一张卡）：

```
[图标] [工具名] · [一行 summary]              ← 工具返回的 summary 字段直接拿出来
  ⎿ 第 1 条预览                                ← 工具返回的 meta.list[]，最多 5 条
    第 2 条预览
    第 3 条预览
    第 4 条预览
    第 5 条预览
    还有 12 个                                ← 超过 5 条用"还有 N 个"概括
```

数据从工具返回的 ToolResult 直接取：

| 前端位置 | 工具返回字段 |
|---|---|
| 工具名右侧的一行 | `summary` |
| 缩进预览列表（前 5 + 还有 N） | `meta.list[]`（**只有 "碰了一组东西" 的工具才挂**，如 search / list） |
| 工具名旁的入参描述 | 关键入参（如 `search "量子计算"`，不光秃秃一个 `Search`） |

**关键约束**：

1. **summary 是人话，不含内部 ID**——用户能看懂。如果你的 summary 里出现 `src_xxx12ab34` 或 `ci_8f3...` → 是把内部物泄漏给了用户
2. **预览限 5 条 + "还有 N 个"**——既给信息量，又不挤爆对话流
3. **只有"碰了一组东西"的工具挂 list**：
   - ✓ `search_X / list_X` 命中一组 → 挂
   - ✓ `list_unread` 列了未读 → 挂
   - ✗ `read_email` 看一封 → **不**挂（不是组）
   - ✗ `handle_email` 处理一封 → **不**挂

**判断标准**：

- 你工具返回的 summary 拿到前端直接展示给用户看，是不是人话？
- 工具是「碰了一组东西」类的，meta 里有没有 list 字段供前端预览？没有 → 前端会秃
- 入参里有没有"对用户没意义但工具又必须传"的字段？（如 sessionId / requestId）→ 别让前端展示

**举例**（整理收件箱）：

| 工具 | summary | meta.list | 前端展示 |
|---|---|---|---|
| list_unread | "47 封未读" | `['张三 · 关于发票', '李四 · 周报', ...]` | 一行 + 5 条预览 + "还有 42 个" |
| read_email | "已读 · 张三 · 关于发票" | 不挂 | 单行 |
| handle_email | "已归档到 bills 文件夹" | 不挂 | 单行 |

---

#### 后台/cron 类：结构化日志

后台 agent 没用户在场，用日志做"事后可观测"。仍然用同一份 `summary + meta` 字段，只是输出靶子换成日志：

```
[agent] tool=list_sources    summary="5 个可用信息源"
[agent] tool=browse          summary="Hacker News 过去 7 天 23 条"
                              sourceRef=s1 totalFetched=50 afterDedupe=23 took=820ms
[agent] tool=search          summary="搜 'Claude 4.7' · 命中 8 条" query=...
[agent] tool=pick            summary="挑了 3 条" pickedRefs=['i1','i5','i12']
```

- `summary` → 日志一行人话（适合 grep / 给运维看）
- `meta.*` 字段 → 结构化 fields（适合 Datadog / ELK 聚合查询）
- 错误同样打：`tool=browse status=error errorCode=SOURCE_FETCH_FAILED sourceRef=s1 reason=timeout`

**判断标准**：日志条目能不能让运维**事后还原** agent 的决策路径？需要的话留下来；纯调试细节别污染日志。

---

## 自检

写完工具，每个工具问自己 5 个问题：

1. **透明度**：description 写完后，LLM 调用前能不能看懂"这工具会做什么、范围多大、用什么逻辑"？把决策藏在内部 = 不透明 = LLM 没法判断"够不够支持我的任务"。
2. **参数**：每个必填参数都来自合法 3 来源（任务描述 / 上一步工具返回 / 系统注入）吗？任何一个不在 → agent 会瞎编。
3. **返回**：里面有没有 `next_action / suggestion / 建议 X` 这种字段？有 → 改成事实。
4. **异常**：错误信息是"为什么挂了"，还是"该怎么办"？后者 → 改成前者。
5. **反馈展示**：summary 是不是人话不含内部 ID？「碰了一组东西」的工具有没有 meta.list 给前端预览 / 日志聚合？

---

## 项目沿用

具体的字段命名规范（summary / detail / meta）、ToolResult JSON 契约、jsonSchema 风格、五条边角铁律 —— 见 `docs/agent-tools-redesign.md`。

那些是**实现规范**，本 SKILL 是**设计方法**。两者配合用：

- 设计阶段：用本 SKILL 的 4 步推演
- 实现阶段：按 `agent-tools-redesign.md` 的字段规范落地代码
