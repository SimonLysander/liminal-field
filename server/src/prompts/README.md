# Prompts 总览

> 全项目「我们写给模型的话」集中在 `server/src/prompts/`,文件为唯一真源、随发版、线上不可改。
> 用户在管理 UI 运行时新建/调整的(用户自定义 skill/agent、provider 绑定、全局自定义指令)才进 Mongo。

## 载体原则

- **长文 → `.md`**(systemPrompt、skill body、digest/memory 等),经 `PromptManagerService.render(name, vars)` 加载(`@Global()`,无需逐 module import;`{{var}}` 渲染)。
- **短片段、多条 → 一个 `.ts` 表**(工具描述、反馈文案、内置注册表),消费方直接 import。不为零碎短句各开一个 md。

## 内置的「文件 ∪ Mongo」合成解析

内置 skill/agent「是什么」定义在文件(`builtin-skills.ts`/`builtin-agents.ts` + 对应 md),解析时与 Mongo 用户新建项合并、内置优先:

- `SkillService`:`findByName/findByIds/list` 先查内置(按 key)、再落 Mongo;内置 `_id` 即 key。
- `SystemConfigService.getAgentConfig/getConfigView`:内置定义以文件为准,**provider 绑定与 enabled 以 Mongo 为准**(运行时可调);用户新建 agent 整条存 Mongo。
- 内置不再 seed 进 Mongo,启动无 seed/迁移。管理 UI 对内置项的定义类字段只读(`builtin` 标记)。

## TS 表(短片段)

| 文件 | 用途 | 消费方 |
|---|---|---|
| `tool-descriptions.ts` | 全部工具的 description | `ToolAssembler` 组装时按工具名套用 |
| `feedback.ts` | 给模型的带外反馈文案(如 HITL 审批回灌) | `AgentService` |
| `builtin-skills.ts` | 内置 skill 元数据 + 指向 body md | `SkillService` |
| `builtin-agents.ts` | 内置 agent 元数据(tools/挂哪些 skill/档位)+ 指向 systemPrompt md | `SystemConfigService` |

## MD 长文

| 路径 | 用途 | 调用方 | 变量 |
|---|---|---|---|
| `skills/note-plan.md` | 内置 skill「规划」正文 | `SkillService`(builtin-skills 引用) | 无 |
| `skills/note-writing.md` | 内置 skill「成稿」正文(含引用规则) | `SkillService`(builtin-skills 引用) | 无 |
| `agents/learning-planner.md` | 学习规划师 systemPrompt | `SystemConfigService`(builtin-agents 引用) | 无 |
| `agents/learning-writer.md` | 学习写手 systemPrompt | 同上 | 无 |
| `agents/gallery-caption-writer.md` | 图说写手 systemPrompt | 同上 | 无 |
| `settings/digest-report-analyst.md` | 报告分析师 systemPrompt(builtin-agents 引用此路径) | 同上 | 无 |
| `digest/react-agent.md` | digest workflow react-agent 主 prompt | `ReactAgentNode` | `topic_name`, `topic_prompt`, `since_iso`, `until_iso` |
| `digest/compose-plan.md` | digest compose 阶段1:分主题+定刊头 | `ComposeNode.plan` | `topic_name`, `findings_list` |
| `digest/compose-write-section.md` | digest compose 阶段2:分主题写正文 | `ComposeNode.writeSection` | `topic_name`, `section_title`, `sources_xml` |
| `sub-agent/researcher.md` | 通用研究助手 system prompt | `SubAgentService` | 无 |
| `memory/profile-renderer.md` | Aurora 画像渲染器 | `MemoryViewService.callViewLLM` | `observations` |
| `memory/owner-memory.md` | 记忆管理器(remember 调 LLM) | `MemoryAgentService.callRememberLLM` | `existing_memories`, `new_content` |
| `memory/session-compactor.md` | 会话压缩器 | `MemoryAgentService.callCompactLLM` | `existing_memories`, `input_text` |
| `aurora/role.md` | Aurora 灵魂人设(`<role>` 段) | `PromptHandler` | `owner_name` |
| `aurora/tools-guide.md` | Aurora 工具使用指引(`<tools>` 段) | `PromptHandler` | `owner_name` |
| `aurora/instructions.md` | Aurora 行为约束(`<instructions>` 段) | `PromptHandler` | `owner_name` |
| `aurora/partials/skills-prelude.md` | `<available_skills>` 固定导语 | `PromptHandler` | 无 |
| `aurora/partials/memories-prelude.md` | `<memories_index>` 固定导语 | `PromptHandler` | 无 |
| `aurora/partials/conversation-summary-prelude.md` | `<conversation_summary>` 固定导语 | `PromptHandler` | 无 |
| `aurora/partials/collection-prelude.md` | `<collection>` 后置说明 | `PromptHandler` | 无 |
| `aurora/partials/gallery.md` | `<gallery>` 画廊场景 section | `PromptHandler` | `owner_name`, `title`, `photo_count`, `has_prose` |
| `aurora/partials/digest-report-prelude.md` | `<digest_report>` partial | `PromptHandler` | `owner_name` |

> 注:`prompt.handler.ts` 中按运行时数据拼装各 `<section>` 的胶水(段落 wrapper、与 owner/上下文数据交织的短句)属组装逻辑,不是可独立 review 的散文 prompt,保留在代码。
