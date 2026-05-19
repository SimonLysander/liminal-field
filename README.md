# Liminal Field

个人内容管理系统。笔记、画廊、文集三个内容模块，统一的版本管理和发布体系。

## 架构总览

```
┌─────────────┐         ┌────────────────────────────────────────┐
│  React 19   │         │           NestJS 11 + Fastify          │
│  + Vite     │         │                                        │
│             │         │  ┌──────────────────────────────────┐  │
│  展示端      │         │  │  业务层（ViewService per scope）   │  │
│  管理端      │── API ─→│  │  文件协议解析 / DTO 构造          │  │
│  编辑器      │         │  ├──────────────────────────────────┤  │
│             │         │  │  版本层（ContentService）          │  │
│             │         │  │  ContentItem 指针 + Snapshot 快照  │  │
│             │         │  ├──────────────────────────────────┤  │
│             │         │  │  存储层                            │  │
│             │         │  │  MongoDB（版本快照） + Git（归档）  │  │
│             │         │  └──────────────────────────────────┘  │
└─────────────┘         └────────────────────────────────────────┘
```

## 内容生命周期

```
新建                编辑               提交                发布
 │                  │                  │                  │
 ▼                  ▼                  ▼                  ▼
创建 ContentItem   写入 EditorDraft   创建 ContentSnapshot   publishedVersion
+ 空 Snapshot      （独立集合，        （bodyMarkdown 快照）  指向某个 Snapshot
+ NavigationNode    不影响版本链）     + 更新 latestVersion   （纯指针操作）
                                      + 删除草稿
                                      + [异步] Git 归档
```

### 提交流程（写入）

```
前端提交
  │
  ▼
ViewService（业务层）
  │  按文件协议把结构化数据编码成 bodyMarkdown
  │  （Gallery: photos/cover/date → frontmatter）
  │  （Anthology: 条目正文 → 独立 snapshot）
  │
  ▼
ContentService（版本层）
  │  [同步] 创建 ContentSnapshot（bodyMarkdown = 不透明 blob）
  │  [同步] 更新 ContentItem.latestVersion 指针
  │  [同步] 更新 ContentItem.updatedAt
  │
  ▼
Git（存储层，异步）
  │  写文件到磁盘 → git add + commit → 回填 commitHash
  │  失败不影响业务版本
  ▼
```

### 读取流程

```
前端请求
  │
  ▼
ViewService（业务层）
  │  从版本层拿 ContentItem + ContentSnapshot
  │  │
  │  ▼
  │  ContentService（版本层）
  │  │  查 ContentItem → 取 publishedVersion/latestVersion 的 versionId
  │  │  查 ContentSnapshot → 返回 bodyMarkdown
  │  │  （版本层不解析 bodyMarkdown，原样返回）
  │  │
  │  ▼
  │  按文件协议解析 bodyMarkdown → 提取结构化数据
  │  URL 重写（./assets/ → 可访问 URL）
  │  构造业务 DTO
  │
  ▼
返回前端
```

### 发布流程

```
Notes / Gallery:
  publishedVersion 指向 latestVersion 的 snapshot → 完成

Anthology（两层发布，先发布文集才能发布条目）:

  创建文集、写几篇
    → 文集未发布，读者看不到
  
  发布文集（ContentItem.publishedVersion 指向索引 snapshot）
    → 文集对读者可见，但条目列表为空（还没有条目被发布）
  
  发布某篇条目（索引 frontmatter 记录 publishedVersionId）
    → 那篇对读者可见，冻结在发布时的版本
  
  继续写新篇 / 编辑已发布篇
    → 读者看不到变化，直到再次发布那篇

  索引 frontmatter：
    entries:
      - key: e001
        title: 沉没
        publishedVersionId: "snapshot-xxx"   ← 已发布，冻结版本
      - key: e002
        title: 漂流
        publishedVersionId: null             ← 未发布，读者看不到

  读者看到条目的条件：文集已发布 AND 该条目 publishedVersionId 非 null
```

## 三层架构

### 存储层（Git + MongoDB）

Git 仓库存文件，MongoDB 存版本快照。**两者完全解耦——Git 提交和业务版本是两件独立的事。**

- **MongoDB ContentSnapshot**：业务版本的源，存 bodyMarkdown（一个文件的完整内容）
- **MongoDB ContentItem**：版本指针（latestVersion / publishedVersion）
- **Git**：异步归档，commitHash 回填。挂了不影响业务

### 版本层（ContentService）

scope 无关的版本 CRUD。**不解析 bodyMarkdown，不知道里面装的是什么。**

- 提交版本 → 新建 ContentSnapshot + 更新 latestVersion 指针
- 发布 → publishedVersion 指向某个 snapshot（纯指针操作，不写 Git）
- 草稿 → 独立的 EditorDraft 集合，不影响版本链
- fileName 支持 → 同一个 ContentItem 下可存多个文件的 snapshot（Anthology 用）

### 业务层（ViewService）

最薄的一层。每个 scope 一个 ViewService，负责：

- **定义文件协议**：bodyMarkdown 怎么编码内容元数据（frontmatter 格式）
- **序列化/反序列化**：前端结构化数据 ↔ bodyMarkdown 字符串
- **构造 DTO**：从 snapshot 解析出前端需要的格式
- **URL 重写**：`./assets/` → 可访问的 URL

## 内容模块

### Notes

一篇笔记 = 一个 ContentItem。bodyMarkdown = frontmatter（title）+ markdown 正文。

```
content/ci_xxx/
├── main.md
└── assets/
```

### Gallery

一个相册 = 一个 ContentItem。bodyMarkdown = frontmatter（title + photos + cover + date + location）+ 随笔文字。

```
content/ci_xxx/
├── main.md
└── assets/
    ├── photo-001.jpg
    └── photo-002.jpg
```

### Anthology（文集）

一个文集 = 一个 ContentItem。索引（main.md）的 bodyMarkdown = frontmatter（title + description + entries 列表）。各篇正文通过 fileName 区分，各自独立存储在 ContentSnapshot 中。

```
content/ci_xxx/
├── main.md          ← 索引
├── entries/
│   ├── e001.md      ← 各篇正文（独立 snapshot，fileName="entries/e001.md"）
│   ├── e002.md
│   └── e003.md
└── assets/
```

### 统一读取模式

三个 scope 的读取是同一个模式：**解析索引 → 按引用拿产物。**

```
Notes:     解析 main.md → 正文就在 bodyMarkdown 里
Gallery:   解析 main.md frontmatter → 按 file 字段去 OSS 拿照片
Anthology: 解析 main.md frontmatter → 按 key 去 MongoDB 拿条目 snapshot
```

| scope | 索引（main.md） | 产物 | 产物存在哪 |
|-------|---------------|------|-----------|
| Notes | 正文本身 | 无 | — |
| Gallery | 照片列表 + 随笔 | 照片文件 | OSS / assets/ |
| Anthology | 条目目录 | 各篇正文 | MongoDB snapshot（fileName 区分） |

## 设计原则

- **bodyMarkdown = 一个文件的内容**，版本层不解析，业务层按文件协议解析
- **所有文件都有 frontmatter**，title 在 frontmatter 里，系统元数据里的 title 是提取的副本
- **Git 是异步归档，不是读取路径**。读取走 MongoDB snapshot，Git 只用于备份和恢复
- **发布是指针操作**，不产生新版本，不写 Git
- **scope 隔离在导航层（NavigationNode）**，ContentItem / ContentSnapshot 完全不感知 scope
- **Git 提交 ≠ 业务版本**，两者完全解耦

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind 4 |
| 编辑器 | PlateJS |
| 动画 | motion/react |
| 后端 | NestJS 11 + Fastify |
| 数据库 | MongoDB + TypeGoose |
| 对象存储 | Aliyun OSS（草稿资源） |
| 版本归档 | Git |
| 部署 | Docker Compose |

## 开发

```bash
# 服务端
cd server && pnpm install && pnpm start:dev

# 前端
cd client && pnpm install && pnpm dev
```

## 代码检查

```bash
cd server && pnpm build                    # SWC 编译
cd server && npx jest --passWithNoTests    # 单元测试
cd client && npx tsc -b --noEmit           # 类型检查
cd client && pnpm build                    # 生产构建
```
