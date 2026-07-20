# Aurora 系统提示词组成规范

> `prompt.handler.ts` 的 `buildSystemPrompt` 按本规范拼装。
> 核心:**本体 = 谁;工作上下文 = 此刻在干什么(自带 role/background/goal);横切 = 附加数据。**
> 新增场景 = 多一个 work_context 实例,**不得再往全局加块**。

## 三层(按此顺序拼)

### 一、Aurora 本体 —— 谁(所有 agent 都有,不随场景变)

- `<role>` —— Aurora 人设(另一个自我)。**放最前:先立"我是谁"。**
- `<owner>` —— 陪谁(owner 名 / 生日 / 简介,有则附)。
- `<conventions>` —— **仅通用行为约束**：当前只规定用中文（除非明确要求其他语言）。
  - 写作顾问、学习 agent 等场景专属的行为与工具边界归其 work_context。

### 二、横切动态数据 —— 有则附(与场景正交)

- `<available_skills>`(enabledSkills 非空时)
- `<memories_index>`(有画像 / 观察时)
- `<conversation_summary>`(有 session 摘要时)

### 三、工作上下文 `<work_context>` —— 此刻在干什么(per agent / 场景,统一)

> 放在最后(紧挨对话),取 recency——此刻的活最该被模型盯着。

内容 = 拼成:

1. **agent 定义**：内置 agent 先拼 `contextPromptFiles`（始终生效的共享协作约定），再拼 `promptFile`（场景角色与工作方法）；用户新建 agent 只用其 systemPrompt。工具何时用按**本 agent 实际工具**讲，不写死一张主 Aurora 的表。
2. **场景实时数据**:这篇笔记 + 篇目结构 / 这些照片清单 / 简报正文 + findings / 同集子节点…… 按场景拼。

> 统一了原来散落的 `<current_context>` / `<gallery>` / `<collection>` / `<digest_report>`——它们都是 work_context 的实例。
> 其后是 `<tasks>`(写作计划,有未完成才注入),再后是用户全局自定义 prompt。

## 不变量

- **每个块只下发到适用的 agent**：共享编辑契约只下发给明确配置它的编辑类 agent，不灌给画廊、简报等无关场景。
- **新增场景 → 新增一个 work_context 实例**(agent 定义 + 数据),不往本体 / 横切加全局块。
- **工具指引随 agent 工具集变**,不硬编码。

## 迁移(实现时这样落)

- `instructions.md` → 已拆分：通用语言约定留在 `<conventions>`；场景约束进入各自 agent 定义；跨编辑场景的协作边界进入 `contextPromptFiles`。
- `tools-guide.md` → 从全局常驻改为**按 agent 实际工具动态生成**(或并入各 agent 的 work_context)。
- `gallery / collection / digest-report` partials → 并入对应场景的 work_context。
- `role.md` 内容基本不动,只是位置提到最前;`owner` 紧随其后。
