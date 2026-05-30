# Agent 工具重做设计稿(待审)

> 目的:把 Lux 的工具从"各写各的"收敛成**统一契约 + 不偷懒的边角处理**。
> 现状病灶:返回格式三国杀(文本×6 / JSON×2)、截断/溢出**静默丢**、找不到/没改成**静默失败**、`forget` 模糊匹配**可能删错**、`sub_agent` 半截结论**当完整**、统计在**前端算**、内部 ID 泄漏。
> 本稿审定后才动代码。

---

## 1. 统一返回契约 `ToolResult`

所有工具的 `execute` 一律 `return JSON.stringify(result)`,`result` 形如:

```ts
interface ToolResult {
  summary: string;          // 一行人类可读(前端直接显示;也给模型 TL;DR)
  detail?: string;          // 给模型的主体内容(正文 / 命中列表 / 结论…),纯文本
  meta?: {
    status?: 'ok' | 'partial' | 'not_found' | 'ambiguous' | 'error';
    total?: number;         // 命中 / 条目总数
    shown?: number;         // 本次给了多少(条 / 字符)
    hasMore?: boolean;      // 还有没有
    nextOffset?: number;    // 续取用
    [k: string]: unknown;   // 工具特定字段
  };
}
```

- **模型**读整个 JSON(summary + detail + meta 都看得到,能据 meta 决定续取 / 重试)。
- **前端** `ToolCallCard` 退化成:`JSON.parse` → 显示 `summary`,按 `meta` 加极简提示(见 §4)。**前端不再解析文本、不再算统计。**
- 非 JSON 的旧返回 → 前端回退显示原文首行(迁移期兼容)。

---

## 2. 五条边角铁律(贯穿所有工具)

1. **不静默丢**:截断 / 超量 → 必给 `total` + `hasMore` + `nextOffset`,让 agent 能续取。
2. **不静默失败**:找不到 / 没改成 → `status:'not_found'` + 明确 summary,绝不假装成功。
3. **歧义不瞎猜**:匹配到多条 → `status:'ambiguous'` + 候选列表,**不执行破坏性操作**。
4. **不完整要标记**:达步数 / 超时 → `status:'partial'`,summary 写明"结论可能不全"。
5. **不泄漏内部物**:summary 里不出现原始 ID / 类型方括号;ID 放 `meta`(给模型续用)。

---

## 3. 逐工具规格

### 3.1 `search_knowledge_base`(grep:按内容找)
- **参数**:`query: string`(必)· `scope?` · `limit?`(默认 10)· `offset?`(默认 0)
- **行为**:全文搜索,按相关性排序,分页。
- **返回**
  - `summary`:`命中 23 篇:指令系统、存储系统、内存管理 …`(头几个 + 总数);0 条→`没找到匹配「query」`
  - `detail`:本页命中,每条 `[scope] 标题 · id · 片段`
  - `meta`:`{status:'ok'|'not_found', total, shown, offset, hasMore, nextOffset}`
- **边角**:命中 > limit → `hasMore:true`;0 条 → `not_found`(不是空字符串)。

### 3.2 `list_knowledge_base`(ls:看有哪些)
- **参数**:`scope?` · `limit?`(默认 50)· `offset?`(默认 0)
  - ❌ **不加**时间范围 / 排序:库是个人量级,模型拿到全量(带日期)自己能筛;加了是没人用的旋钮。
- **行为**:**轻量枚举**——只取 标题 / id / scope / 路径 / 日期,**不拉 snapshot、不抽摘要**(修当前性能问题)。
- **返回**
  - `summary`:`共 50 篇 · 笔记 44 / 相册 5 / 文集 1`(类型构成,后端算)
  - `detail`:条目列表,每条 `[scope] 标题 · id · 路径 · 日期`
  - `meta`:`{status:'ok', total, shown, byScope:{notes,gallery,anthology}, hasMore, nextOffset}`
- **边角**:> limit → `hasMore`,summary 标"共 N,这是前 X"。

### 3.3 `read_document_content`(cat:读全文)
- **参数**:`contentItemId: string`(必)· `offset?`(默认 0,字符位)· `limit?`(默认 ~6000 字)
- **行为**:从 offset 起返回**一段(默认 ~6000 字,约一节的量)**;`limit?` 可临时调。短文一次读完,长文用 offset 续(避免一次性灌爆上下文)。
- **返回**
  - `summary`:`指令系统 · 30,861 字 · 67 章节`(长文再标 `· 读到 0–6000 字`)
  - `detail`:**outline 永远给全** + 本段正文
  - `meta`:`{status:'ok'|'not_found', wordCount, outlineCount, offset, shown, hasMore, nextOffset}`
- **边角**:超长 → `hasMore` + `nextOffset`,agent 自己决定续不续;id 无效 → `not_found`。

### 3.4 `get_current_draft`(读当前草稿)
- **参数**:`offset?`(默认 0)
- **行为 / 返回**:**与 read 完全一致**(title / outline 全 / 正文段 / meta),另加 `paragraphs`。无草稿 → `status:'not_found'`,summary `当前没有打开的草稿`。
- **边角**:与 read 共用同一截断 + 续取策略(修当前 2000 vs 8000 不一致)。

### 3.5 `remember`(记)
- **参数**:`content: string`(必)
- **返回**
  - `summary`:`已记住:新建「X」` 或 `已记住:并入「Y」`(说清新建 / 合并)
  - `meta`:`{status:'ok', action:'created'|'merged'|'updated', memoryTitle, type}`
- **边角**:回执必须让 agent 知道**发生了什么**(新建还是并到哪条),不是笼统"已记住"。

### 3.6 `forget`(删记忆)—— 风险最高
- **参数**:`target: string`(必)
- **行为**:匹配 → **1 条**:删 + 回执;**0 条**:not_found;**多条**:ambiguous,**列出候选,不删**。
- **返回**
  - 1 条:`summary` `已忘记「X」`,`meta.status:'ok'`
  - 0 条:`summary` `没找到匹配「target」的记忆`,`meta.status:'not_found'`
  - 多条:`summary` `匹配到多条,未删除,请指明:A / B / C`,`meta:{status:'ambiguous', candidates:[…]}`
- **边角**:**绝不在歧义时随手删一条**(当前最大数据安全洞)。

### 3.7 `sub_agent`(委派)
- **参数**:`task: string`(必)· `max_steps?`(默认 12)
- **返回**
  - `summary`:`完成 · N 步` 或 `未完成 · 达 N 步上限,结论可能不全`
  - `detail`:结论
  - `meta`:`{status:'ok'|'partial'|'timeout', stepsUsed, documentsRead}`
- **边角**:达 maxSteps / 超时 → `partial`/`timeout`,**主 agent 要知道这是半截**,不能当完整结论用。

### 3.8 `create_task`(建任务)
- **参数**:`title`(必)· `description?` · `blockedBy?: string[]`
- **行为**:校验 `blockedBy` 里的 task ID 是否存在。
- **返回**
  - `summary`:`已建任务「title」`(**id 不进 summary**)
  - `meta`:`{status:'ok', taskId, blockedByMissing?: string[]}`
- **边角**:`blockedBy` 引用了不存在的 ID → `meta.blockedByMissing` + summary 提示。

### 3.10 `recall_memory`(按标题精确读全文,#150 2026-05-31)

> 配合 prompt 顶部 `<memories_index>` 只塞 user 记忆**标题索引**(全文按需化,见 prompt.handler v3.2);agent 看到标题,要全文就调这条。

- **参数**:`title: string`(必,与索引标题精确一致,前后空格 trim)
- **行为**:精确按 `title` 查 user 记忆;命中即返全文。**`session` 类型(草稿级会话脉络)挡回**——summary 不复述其 content,防内部 tasks/agentKey 字段泄漏。
- **返回**
  - 命中:`summary` `已读取「X」· 312 字`,`detail` 全文,`meta:{status:'ok', memoryTitle, type:'user'}`
  - 找不到 / session 类型:`summary` `没找到标题为「X」的 user 记忆,回看 <memories_index> 核对标题`,`meta.status:'not_found'`
- **边角**:user 记忆体量小(一般几百字内),**不分页**(对照 §3.3 read_document_content 是长文才需要 offset/limit);找不到给出"回看索引"的下一步,避免 agent 瞎试。

> **隐式 meta 字段** `list?: string[]`(命中 / 候选项标题数组)给前端 `ToolCallCard` 的
> NestedList(⎿ 对齐)用。`search_knowledge_base` / `list_knowledge_base` / `search_memories`
> 都遵循该约定。

### 3.11 `search_memories`(模糊搜 user 记忆,#150 2026-05-31)

> 索引外想查(模糊匹配 title + content),来这搜;查到候选标题后用 `recall_memory(title)` 读全文。

- **参数**:`query: string`(必,空串 = 按更新时间倒序列全部) · `limit?`(默认 10) · `offset?`(默认 0)
- **行为**:全表(只 user 类型;**session 不搜**)case-insensitive 模糊匹配 title + content,按更新时间倒序返一页。
- **返回**
  - `summary`:`命中 23 条:身份、写作偏好、饮食 …`(头 3 个标题 + 总数);0 条 → `没找到匹配「query」的记忆`
  - `detail`:本页候选,每条 `- 标题`(不返 content;模型挑一个再调 recall)
  - `meta`:`{status:'ok'|'not_found', total, shown, offset, hasMore, nextOffset, list}`,`list = page.map(title)`(给前端 NestedList 渲染)
- **边角**:
  - 截断 → 必给 `total + hasMore + nextOffset`,**铁律 1"不静默丢"**
  - 0 条 → `not_found`,不返空字符串
  - **不搜 session 类型**——防内部脉络命中泄漏(与 recall 一致策略)

### 3.9 `update_task`(改任务)
- **参数**:`task_id`(必)· `status?` · `title?` · `description?`
- **行为**:先查任务是否存在。
- **返回**
  - 成功:`summary` `已更新「title」· 状态→done`,`meta:{status:'ok', taskId, changes}`
  - 不存在:`summary` `任务不存在(无法更新)`,`meta.status:'not_found'`
  - 无字段:`summary` `没有要更新的字段`
- **边角**:`task_id` 不存在 → **明确 not_found,不静默 no-op**。

---

## 4. 前端契约(`ToolCallCard`)

- `JSON.parse(result)` → `{summary, meta}`;**只渲染 summary**(批注左边线 + 工具图标,已做)。
- 按 `meta` 加**极简**提示(不喧宾夺主):
  - `status:'partial'|'timeout'` → summary 后一个淡色"· 未完成";
  - `status:'not_found'` → 图标/文字走 `--ink-ghost`(中性,不报红,因为不是错误);
  - `status:'ambiguous'` → 淡色"· 需确认";
  - `hasMore` → 末尾淡色"…";
  - `status:'error'` → `--danger`。
- 非 JSON(旧)→ 回退显示原文首行(迁移期)。
- **前端不解析文本、不算统计、不拼接 ID。**

---

## 5. 实施顺序(审定后)

1. 定义 `ToolResult` 类型 + 一个 `toolResult()` 小工具函数(server)。
2. 前端 `ToolCallCard` 改成"解析 JSON → 渲染 summary + meta 提示"(带旧格式回退)。
3. 逐个工具改返回(search → list → read → draft → forget → update_task → create_task → sub_agent → remember),每个改完即 lint + 手测。
4. `list` 顺带换轻量枚举(后端加"不拉 snapshot"的列举路径)。
5. 全套验证:server build / client tsc+lint / 手测每个工具的正常 + 边角(0 条 / 多条 / 超长 / 不存在)。

---

## 变更记录
- **2026-05-24** 初稿。统一 `ToolResult` 契约 + 五条边角铁律 + 九工具逐个规格。待审。
