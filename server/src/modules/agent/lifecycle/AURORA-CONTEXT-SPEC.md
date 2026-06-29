# Aurora 系统提示词组成规范

> `prompt.handler.ts` 的 `buildSystemPrompt` 按本规范拼装。
> 核心:**本体 = 谁;工作上下文 = 此刻在干什么(自带 role/background/goal);横切 = 附加数据。**
> 新增场景 = 多一个 work_context 实例,**不得再往全局加块**。

## 三层(按此顺序拼)

### 一、Aurora 本体 —— 谁(所有 agent 都有,不随场景变)

- `<role>` —— Aurora 人设(另一个自我)。**放最前:先立"我是谁"。**
- `<owner>` —— 陪谁(owner 名 / 生日 / 简介,有则附)。
- `<conventions>` —— **仅通用行为约束**:用中文(除非明确要求他语)、依赖文档/库的先看原文再说·不装懂、不重复已说过的。
  - ⚠ 写作顾问专属的(「不改正文、只给建议」「编辑场景的工具选择表」)**不在这里**,归其 work_context。

### 二、横切动态数据 —— 有则附(与场景正交)

- `<available_skills>`(enabledSkills 非空时)
- `<memories_index>`(有画像 / 观察时)
- `<conversation_summary>`(有 session 摘要时)

### 三、工作上下文 `<work_context>` —— 此刻在干什么(per agent / 场景,统一)

> 放在最后(紧挨对话),取 recency——此刻的活最该被模型盯着。

内容 = 拼成:

1. **agent 定义**:该 agent 的提示词,按骨架(`# Role` / `## Background` / `## Goal` / `## Constraints`)。来自 `builtin-agents.ts` 的 promptFile,或用户新建 agent 的 systemPrompt;工具何时用按**本 agent 实际工具**讲,写在该 agent 的提示词里(如 writing-advisor.md),不写死一张主 Aurora 的表。
2. **场景实时数据**:这篇笔记 + 篇目结构 / 这些照片清单 / 简报正文 + findings / 同集子节点…… 按场景拼。

> 统一了原来散落的 `<current_context>` / `<gallery>` / `<collection>` / `<digest_report>`——它们都是 work_context 的实例。
> 其后是 `<tasks>`(写作计划,有未完成才注入),再后是用户全局自定义 prompt。

## 不变量

- **每个块只下发到适用的 agent**:主写作 Aurora 的约束不灌给 learning-writer / gallery-caption 等。
- **新增场景 → 新增一个 work_context 实例**(agent 定义 + 数据),不往本体 / 横切加全局块。
- **工具指引随 agent 工具集变**,不硬编码。

## 迁移(实现时这样落)

- `instructions.md` → 拆两半:通用部分(用中文 / 不装懂 / 不重复)→ `<conventions>`;写作顾问专属(不改正文给建议、多步列计划、交付起点非终稿)→ **writing-advisor 的 work_context 定义**(它现在 systemPrompt 为空,正好补上)。
- `tools-guide.md` → 从全局常驻改为**按 agent 实际工具动态生成**(或并入各 agent 的 work_context)。
- `gallery / collection / digest-report` partials → 并入对应场景的 work_context。
- `role.md` 内容基本不动,只是位置提到最前;`owner` 紧随其后。
