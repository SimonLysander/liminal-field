# Liminal Field · 设计文档

这里只放**设计**——技术架构设计、UI 系统设计、Agent 系统设计。三者本质相同:记录**人做的设计决策与理由**。

## 一条铁律:只写设计,不写施工

> 文档记「为什么这么选、放弃了什么、踩过什么坑所以这么定」——这些不随代码过时。
> 文档**不**记「有哪些类、哪些字段、哪些工具、什么签名」——那是施工细节,会随代码烂掉,而且 `*.entity.ts` / `*.tool.ts` 的行内注释已经在做这件事。需要落地细节时,文档给一个指向代码的指针即可。
>
> 判断标准:这句话三个月后还成立吗?成立→留;会变→删,或改成指向代码的指针。
>
> (本目录此前积压了一批「施工图」式文档,代码演进后大面积失准,已于 2026-06-23 按此铁律重构。)

## 三支柱

### 🏛 技术架构设计 — `architecture/`
| 文档 | 讲什么 |
|---|---|
| [overview.md](architecture/overview.md) | 项目全景:模块图、数据流、选型决策 |
| [content-model.md](architecture/content-model.md) | 内容底座:为什么 MongoDB 主存 + Git 异步归档、多文件模型 |

### 🎨 UI 系统设计 — `design-system/`
| 文档 | 讲什么 |
|---|---|
| [language.md](design-system/language.md) | 设计「宪法」:为什么霞鹜文楷、草木隐喻、克制 |
| [tokens.md](design-system/tokens.md) | 字号/色彩/间距的语义分级(值见 `client/src/index.css`) |

### 🤖 Agent 系统设计 — `agent/`
| 文档 | 讲什么 |
|---|---|
| [architecture.md](agent/architecture.md) | Aurora 底座:接入层、分层 handler、记忆系统、生命周期/hooks |
| [tool-design.md](agent/tool-design.md) | 给 LLM 设计工具的方法论 + ToolResult 契约 + 踩坑(本身是个 skill) |
| [digest-workflow.md](agent/digest-workflow.md) | 简报:一种 agent 工作流的关键设计决策 |
| [learning-notes-workflow.md](agent/learning-notes-workflow.md) | 学习笔记生成:思维模型→行文逻辑/文风→产品形态(规划+研究式产出→重写)的核心设计 |

## 其它
- `figures/` — `.excalidraw` 结构图(简报工作流、版面解剖)
