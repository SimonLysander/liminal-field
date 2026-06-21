# Prompts 总览(通天晓)

> 全部 system prompt / agent 模板统一放这里,一个文件一个 prompt。
> 调用方用 `PromptManagerService.render(name, vars)` 加载。
> `PromptManagerModule` 标注 `@Global()`,无需逐 module import。

## 索引

| 路径 | 用途 | 调用方 | 变量 |
|---|---|---|---|
| `digest/react-agent.md` | digest workflow react-agent 主 prompt | `ReactAgentNode` | `topic_name`, `topic_prompt`, `since_iso`, `until_iso` |
| `digest/compose-report.md` | digest 报告 compose 节点 | `ComposeNode` | `topic_name`, `findings_text` |
| `sub-agent/researcher.md` | 通用研究助手 system prompt | `SubAgentService` | 无 |
| `memory/profile-renderer.md` | Aurora 画像渲染器(从 observations 派生 markdown) | `MemoryViewService.callViewLLM` | `observations` |
| `memory/owner-memory.md` | 记忆管理器(remember 工具调 LLM 决定 create/update) | `MemoryAgentService.callRememberLLM` | `existing_memories`, `new_content` |
| `memory/session-compactor.md` | 会话压缩器(compaction 把旧对话提炼成活摘要) | `MemoryAgentService.callCompactLLM` | `existing_memories`, `input_text` |
| `settings/digest-report-analyst.md` | 简报阅读页追问 agent 默认 system prompt | `SystemConfigService.getReportAnalystEntry` | 无 |
| `aurora/role.md` | Aurora 灵魂人设(`<role>` 段) | `PromptHandler.<role>` | `owner_name` |
| `aurora/tools-guide.md` | Aurora 工具使用指引(`<tools>` 段) | `PromptHandler.<tools>` | `owner_name` |
| `aurora/instructions.md` | Aurora 行为约束(`<instructions>` 段) | `PromptHandler.<instructions>` | `owner_name` |
| `aurora/partials/skills-prelude.md` | `<available_skills>` 的固定导语 | `PromptHandler.<available_skills>` | 无 |
| `aurora/partials/memories-prelude.md` | `<memories_index>` 的固定导语 | `PromptHandler.<memories_index>` | 无 |
| `aurora/partials/conversation-summary-prelude.md` | `<conversation_summary>` 的固定导语 | `PromptHandler.<conversation_summary>` | 无 |
| `aurora/partials/collection-prelude.md` | `<collection>` 的后置说明 | `PromptHandler.<collection>` | 无 |
| `aurora/partials/gallery.md` | `<gallery>` 画廊场景 section | `PromptHandler.<gallery>` | `owner_name`, `title`, `photo_count`, `has_prose` |
| `aurora/partials/digest-report-prelude.md` | `<digest_report>` 相关 partial(备用) | — | `owner_name` |
