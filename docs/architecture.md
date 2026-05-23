# Liminal Field — 产品与架构设计文档

> 版本：2026-05-01  
> 这是一份独立的、完整的项目设计参考文档。涵盖产品定位、技术架构、数据模型、API 设计、前端架构和部署方案。

---

## 目录

1. [产品定位](#1-产品定位)
2. [系统总览](#2-系统总览)
3. [服务端架构](#3-服务端架构)
   - 3.1 模块划分
   - 3.2 内容状态机
   - 3.3 存储层设计
   - 3.4 认证与授权
   - 3.5 API 设计
4. [数据模型](#4-数据模型)
5. [前端架构](#5-前端架构)
   - 5.1 页面与路由
   - 5.2 编辑器架构
   - 5.3 设计系统
   - 5.4 动画系统
6. [关键数据流](#6-关键数据流)
7. [部署与配置](#7-部署与配置)
8. [关键设计决策](#8-关键设计决策)

---

## 1. 产品定位

**Liminal Field** 是一个个人内容管理系统，专为个人知识库管理和内容发布设计。

**核心功能**：
- **Notes（笔记）**：Git 版本控制的富文本笔记，支持草稿、历史版本、发布/撤销发布
- **Gallery（画廊）**：照片动态流，支持多图上传、发布管理
- **展示端**：独立的公开阅读视图，支持双主题切换
- **管理端**：受保护的内容管理界面，单用户鉴权

**核心设计原则**：
- Git 作为内容的唯一可信历史来源（版本不可篡改）
- MongoDB 只存储轻量元数据和指针（不存正文）
- 展示端和管理端共享同一设计语言，视觉完全一致
- 单色系 Apple 风格 UI，减少视觉噪声

---

## 2. 系统总览

```
┌─────────────────────────────────────────────────────┐
│                  liminal-field-web                  │
│              (React 19 + Vite + PlateJS)            │
│                                                     │
│  展示端（/home, /note, /gallery）                    │
│  管理端（/admin/*，JWT 保护）                        │
└────────────────────┬────────────────────────────────┘
                     │ HTTP / REST API
                     │ /api/v1/*
┌────────────────────▼────────────────────────────────┐
│                liminal-field-server                 │
│            (NestJS 11 + Fastify + Pino)             │
│                                                     │
│  WorkspaceModule  ←→  ContentModule                 │
│  NavigationModule ←→  AuthModule                   │
│  MinioModule                                        │
└──────┬──────────────────┬─────────────────┬─────────┘
       │                  │                 │
┌──────▼───┐      ┌───────▼───┐    ┌───────▼───┐
│ MongoDB  │      │  Git 仓库  │    │   MinIO   │
│（元数据） │      │（内容正文） │    │（草稿资源）│
└──────────┘      └───────────┘    └───────────┘
```

**技术栈**：

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React + TypeScript | 19.2.0 / 5.9.3 |
| 前端构建 | Vite | 7.2.4 |
| 富文本编辑 | PlateJS | 53.0.0 |
| 动画 | motion/react (Framer Motion) | 12.38.0 |
| 样式 | Tailwind CSS 4 + CSS 变量 | 4.2.4 |
| 后端框架 | NestJS + Fastify | 11.0.1 / 5.8.5 |
| 日志 | Pino | — |
| 数据库 | MongoDB + TypeGoose | 9.1.6 / 13.1.0 |
| 内容版本控制 | Git（shell 调用） | — |
| 对象存储 | MinIO（草稿资源） | 8.0.7 |
| 认证 | JWT（httpOnly cookie） | 11.0.2 |

---

## 3. 服务端架构

### 3.1 模块划分

服务端采用三层架构，职责严格分离：

```
AuthModule          — 鉴权层（单用户 JWT）
├── ContentModule   — 存储层（Git + MongoDB，无业务概念）
├── NavigationModule— 索引层（树形导航，scope 隔离）
├── MinioModule     — 对象存储层（草稿资源生命周期）
└── WorkspaceModule — 业务层（跨 scope CRUD + 特化编排）
    ├── WorkspaceService    — 通用 CRUD（create/update/delete/publish）
    ├── NoteViewService     — Notes 特化（草稿、版本历史、资源上传）
    └── GalleryViewService  — Gallery 特化（DTO 组装、封面图处理）
```

**为什么这样分层**：`ContentModule` 只理解"内容"的物理存储（文件系统 + Git + MongoDB），不理解"笔记"或"画廊"的概念。`WorkspaceModule` 作为薄业务层负责编排，增加新 scope 只需扩展枚举值，不影响存储层。

### 3.2 内容状态机

每个 ContentItem 有三个独立的"版本概念"，语义彻底分离：

```
┌────────────────────────────────────────────────────────┐
│                      ContentItem                       │
│                                                        │
│  editorDraft          最新草稿（MongoDB，autosave 缓冲）│
│       ↓ commit                                         │
│  latestVersion ────── Git commitHash（最新正式版本头）  │
│       ↓ publish                                        │
│  publishedVersion ─── Git commitHash（当前公开版本头）  │
│                                                        │
│  * publish 只切换指针，不创建新的 Git commit            │
│  * Git 工作区永远干净（无 staged/unstaged 状态）        │
└────────────────────────────────────────────────────────┘
```

**状态转换规则**：

| 操作 | Git | MongoDB | 副作用 |
|------|-----|---------|--------|
| `saveDraft` | 无 | 写入 editorDraft | autosave，不产生版本 |
| `commit` | 创建新 commit | 更新 latestVersion 指针 | 清理 editorDraft，MinIO 资源落盘 |
| `publish` | 无 | publishedVersion := latestVersion | 内容对外可见 |
| `unpublish` | 无 | publishedVersion := null | 内容对外不可见 |
| `discardDraft` | 无 | 删除 editorDraft | 清理 MinIO 草稿资源 |

### 3.3 存储层设计

#### Git 知识库（ContentRepoService + ContentGitService）

```
/liminal-field-kb/          ← Git 仓库根目录
├── .git/
└── content/
    ├── ci_abc123/
    │   ├── body.md          ← 内容正文（markdown）
    │   └── assets/
    │       ├── cover-a1b2c3d4.jpg
    │       └── diagram-e5f6g7h8.png
    └── ci_def456/
        ├── body.md
        └── assets/
```

- **每次 commit** 对应一个内容版本，`commitHash` 作为版本 ID
- **资源文件名** 经过消毒（小写 + 去特殊字符 + 8 位 UUID 后缀防冲突）
- **分支策略**：`workspace/local`（本地工作分支），可配置推送远程

#### MongoDB 元数据

MongoDB 只存三类数据：

1. **ContentItem** — 版本头指针（latestVersion / publishedVersion）
2. **NavigationNode** — 树形导航索引（scope 隔离，支持多层级）
3. **EditorDraft** — 草稿缓冲区（autosave 内容，与 ContentItem 解耦）

**设计原则**：正文 markdown、资产文件从不进入 MongoDB，查询开销永远恒定。

#### MinIO 草稿资源

解决"编辑草稿时粘贴图片"的问题：图片不能直接写入 Git（草稿随时可丢弃），也不能依赖第三方 CDN。

```
生命周期：

粘贴图片
  → POST /notes/items/:id/draft-assets
  → MinIO: draft-assets/{id}/{sanitized-name}
  → 编辑器 src = /api/v1/.../draft-assets/{name}（代理 URL）

commit 触发
  → MinIO 下载所有资源到 Git assets 目录
  → markdown 中草稿 URL 改写为 ./assets/{name}
  → git commit
  → MinIO 清理该 contentItemId 下所有对象

discard 触发
  → MinIO 清理（同上）
  → MongoDB editorDraft 删除
```

MinIO 不可用时降级：启动日志打 WARN，草稿资源功能不可用，不阻塞应用。

### 3.4 认证与授权

#### 单用户密码认证

- 密码来源：环境变量 `ADMIN_PASSWORD`（明文，bcrypt hash 缓存内存）
- 登录成功 → 签发 JWT（7 天有效期）→ 写入 httpOnly cookie
- Cookie 配置：`sameSite: strict`、`secure: true`（生产）、`path: /api`

#### 全局 Guard 策略

全局注册 `JwtAuthGuard`（`APP_GUARD`），默认所有路由需鉴权。通过 `@Public()` 装饰器显式标记公开路由，防止遗漏保护。

**公开路由清单**：

```
POST  /auth/login          — 登录
GET   /auth/check          — 检查登录态（前端路由守卫用）
GET   /search              — 全局搜索（service 层强制 published 过滤）
GET   /home                — 首页聚合
GET   /spaces/:scope/items — 内容列表（service 层强制 published 过滤）
GET   /spaces/:scope/items/:id — 内容详情（同上）
GET   /spaces/:scope/items/:id/assets/:fileName — 资产直出
```

注意：公开路由在 service 层二次过滤 `visibility: published`，即使 JWT 被伪造也只能访问已发布内容。

### 3.5 API 设计

#### 认证

```
POST  /api/v1/auth/login         { password }   → { token }（httpOnly cookie）
POST  /api/v1/auth/logout                        → 清除 cookie
GET   /api/v1/auth/check                         → { isAuthenticated, role }
GET   /api/v1/auth/sync-status                   → Git 同步状态
POST  /api/v1/auth/sync                          → git push
```

#### 全局

```
GET  /api/v1/search?q=&visibility=               → 跨 scope 搜索
GET  /api/v1/home                                → 首页聚合（hero + featured + latest）
```

#### 结构导航

```
GET    /api/v1/structure-nodes?parentId=&scope=  → 树形列表
POST   /api/v1/structure-nodes                   → 创建节点
PUT    /api/v1/structure-nodes/:id               → 更新节点
DELETE /api/v1/structure-nodes/:id               → 删除（级联）
POST   /api/v1/structure-nodes/reorder           → 同级排序
GET    /api/v1/structure-nodes/:id/path          → 面包屑路径
GET    /api/v1/contents/:contentItemId/structure-path → 反查路径
```

#### Workspace（通用 CRUD，所有 scope 共享）

```
GET    /api/v1/spaces/:scope/items               → 列表（?status=published|committed|all）
POST   /api/v1/spaces/:scope/items               → 创建
GET    /api/v1/spaces/:scope/items/:id           → 详情（?visibility=all|public）
PUT    /api/v1/spaces/:scope/items/:id           → 更新 / 正式提交
DELETE /api/v1/spaces/:scope/items/:id           → 删除
PUT    /api/v1/spaces/:scope/items/:id/publish   → 发布
PUT    /api/v1/spaces/:scope/items/:id/unpublish → 取消发布
POST   /api/v1/spaces/:scope/items/:id/assets    → 上传资产（multipart）
GET    /api/v1/spaces/:scope/items/:id/assets    → 资产列表
GET    /api/v1/spaces/:scope/items/:id/assets/:fileName → 资产直出
```

#### Notes 特化端点（注册在通用 `:scope` 路由之前）

```
GET    /api/v1/spaces/notes/items/:id/draft                     → 获取草稿
PUT    /api/v1/spaces/notes/items/:id/draft                     → 保存草稿（autosave）
DELETE /api/v1/spaces/notes/items/:id/draft                     → 丢弃草稿
GET    /api/v1/spaces/notes/items/:id/history                   → 版本历史列表
GET    /api/v1/spaces/notes/items/:id/versions/:commitHash      → 时间旅行（只读）
POST   /api/v1/spaces/notes/items/:id/draft-assets              → 上传草稿资源
GET    /api/v1/spaces/notes/items/:id/draft-assets/:fileName    → 代理草稿资源
```

**路由注册顺序**：NestJS/Fastify 按注册顺序匹配，`notes/items/:id/draft` 必须注册在 `:scope/items/:id` 之前，否则 `notes` 被当作 scope 参数匹配。

---

## 4. 数据模型

### ContentItem（MongoDB collection: `content_items`）

```typescript
{
  _id: string,                    // "ci_" + uuid 前12位，业务 ID
  latestVersion: {
    commitHash: string,           // Git SHA，最新正式 commit
    title: string,
    summary?: string,
    changeNote?: string,
    changeType?: 'patch' | 'major',
    committedAt: Date,
  },
  publishedVersion?: {            // null = 未发布
    commitHash: string,           // 与 latestVersion 相同或历史版本
    title: string,
    summary?: string,
    publishedAt: Date,
  },
  changeLog?: ContentChangeLog[], // 历史版本列表（元数据，不含正文）
  createdAt: Date,
  updatedAt: Date,
}
```

### NavigationNode（MongoDB collection: `navigation_nodes`）

```typescript
{
  _id: ObjectId,                  // Mongo 原生 ID（前端用 string）
  scope: 'notes' | 'gallery',    // scope 隔离
  name: string,                   // 显示名称
  parentId?: ObjectId,            // null = 根节点
  nodeType: 'subject' | 'content', // 文件夹 vs 文件
  contentItemId?: string,         // 关联 ContentItem._id（文件夹为空）
  order: number,                  // 同级排序权重
  createdAt: Date,
  updatedAt?: Date,
}
```

### EditorDraft（MongoDB collection: `editor_drafts`）

```typescript
{
  _id: ObjectId,
  contentItemId: string,          // 关联 ContentItem._id
  title: string,
  summary: string,
  bodyMarkdown: string,           // 草稿正文（可能含草稿资源 URL）
  changeNote: string,
  savedAt: Date,
  savedBy: string,
}
```

---

## 5. 前端架构

### 5.1 页面与路由

```
展示端（公开，MainLayout）
├── /                → 重定向到 /home
├── /home            首页聚合（hero + featured + latest）
├── /note            笔记列表 + 阅读（?doc=:id 打开详情）
│   └── /note?doc=:id  阅读视图（正文 + TOC + AI Chat FAB）
├── /gallery         照片流（上下切换动态，左右翻照片）
├── /agent           AI Agent（预留）
└── /404             Not Found

管理端（JWT 保护，AdminShell）
├── /login           登录页（公开）
├── /admin           → /admin/content
├── /admin/content   笔记管理（树形 + 列表 + 操作）
├── /admin/gallery   画廊管理（列表 + 资产管理）
└── /admin/edit/:id  沉浸式编辑器
```

**展示端布局（MainLayout）**：
```
┌─────────────────────────────────────────┐
│  Sidebar（floating card，fixed left）   │
│  + Topbar（sticky，毛玻璃背景）          │
├─────────────────────────────────────────┤
│  内容区（white --paper 背景，全高滚动）  │
└─────────────────────────────────────────┘
```

**管理端布局（AdminShell）**：
```
┌────────────────────────────────────────┐
│ IconRail │ TreePanel │    内容区        │
│  48px    │  200px    │    flex-1        │
│ 图标导航 │ 导航树    │ 列表 / 详情      │
└────────────────────────────────────────┘
```

### 5.2 编辑器架构

编辑器入口：`/admin/edit/:id`（`DraftEditPage`）

```
DraftEditPage
├── DraftAssetProvider（提供 contentItemId 给编辑器内部）
├── PlateMarkdownEditor（PlateJS 富文本编辑器）
│   └── PlaceholderElement
│       └── useUploadFile()（从 DraftAssetContext 读取 contentItemId）
│           → POST /api/v1/spaces/notes/items/:id/draft-assets
│           → 返回预览 URL（代理 MinIO）
├── 右侧 Outline（从 markdown 提取标题，点击跳转）
└── CommitDialog（⌘S 打开，填写 summary + changeNote + changeType）
```

**PlateJS 插件配置**（主要）：
- 基础格式：bold, italic, underline, strikethrough, code
- 块级：heading (h1-h3), blockquote, hr
- 列表：bulleted, numbered, indent
- 代码块：带语法高亮（highlight.js）
- 媒体：image（通过 PlaceholderPlugin 触发上传）
- 高级：table, callout, toggle, toc
- 输出：`@platejs/markdown`（PlateJS 值 ↔ markdown 双向转换）

**编辑器快捷键**：
- `⌘S` — 打开提交对话框
- `⇧⌘S` — 立即保存草稿
- 自动保存：编辑停止 1.5s 后触发

### 5.3 设计系统

设计原则：**展示端和管理端相同语义角色的组件，视觉规格完全一致。**

#### 主题系统

双主题：`daylight`（亮）/ `midnight`（暗）。通过根元素 `[data-theme]` 属性切换，localStorage 持久化，入口前置设置避免主题闪现。

#### 配色系统

**表面色**（Surfaces）：

| Token | Daylight | Midnight |
|-------|----------|----------|
| `--paper` | `#FFFFFF` | `#161617` |
| `--paper-dark` | `#F5F5F7` | `#1C1C1E` |
| `--shelf` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` |
| `--sidebar-bg` | `#F2F2F2` | `#1C1C1E` |
| `--bar-bg` | `rgba(255,255,255,0.8)` | `rgba(28,28,30,0.82)` |

**文字色**（四级墨色系）：

| Token | 语义 | Daylight | Midnight |
|-------|------|----------|----------|
| `--ink` | 标题、强调 | `#1D1D1F` | `#F5F5F7` |
| `--ink-light` | 正文 | `#424245` | `#D1D1D6` |
| `--ink-faded` | 次要说明 | `#6E6E73` | `#98989D` |
| `--ink-ghost` | 占位符、禁用 | `#AEAEB2` | `#48484A` |

**语义标记色**（唯一彩色，克制使用）：

| Token | 语义 | Daylight | Midnight |
|-------|------|----------|----------|
| `--mark-red` | 错误、删除、危险 | `#FF3B30` | `#FF453A` |
| `--mark-blue` | 链接、草稿状态、信息 | `#007AFF` | `#0A84FF` |
| `--mark-green` | 成功、已发布 | `#34C759` | `#30D158` |

**强调色**（Monochrome，选中态、按钮主色）：

```css
--accent: #1D1D1F / #F5F5F7
--accent-soft: rgba(0,0,0,0.06) / rgba(255,255,255,0.08)
--accent-contrast: #FFFFFF / #161617  /* 在 accent 背景上的文字 */
```

#### 字号系统

全部通过 Tailwind class 引用，不使用 inline `fontSize`：

| Class | 尺寸 | 典型用途 |
|-------|------|---------|
| `text-xs` | 12px | 标签、时间戳、状态 |
| `text-sm` | 14px | 次要说明、侧边栏文字 |
| `text-base` | 16px | 正文、输入框 |
| `text-lg` | 18px | 内容正文 |
| `text-xl` | 20px | 次级标题 |
| `text-2xl` | 24px | 卡片标题 |
| `text-3xl` | 30px | 页面大标题 |

#### 圆角与阴影

```css
/* 圆角 */
--radius-sm: 4px   /* 小标签、badge */
--radius-md: 8px   /* 按钮、输入框 */
--radius-lg: 12px  /* 卡片、panel */
--radius-xl: 16px  /* 弹窗、抽屉 */

/* 阴影（Apple 多层叠加风格） */
--shadow-xs: 0 1px 2px rgba(0,0,0,0.05)
--shadow-sm: 0 2px 8px rgba(0,0,0,0.08)    /* sidebar, cards */
--shadow-md: 0 8px 24px rgba(0,0,0,0.12)   /* hover, panels */
--shadow-lg: 0 16px 48px rgba(0,0,0,0.2)   /* modal, AI chat */
```

#### 样式写法规范

- **字号**：Tailwind class（`text-base`）
- **颜色**：inline style `color: 'var(--ink)'`（CSS 变量无对应 Tailwind class 时）
- **间距/圆角/布局**：Tailwind class 优先
- 同一项目内写法统一，不混用

### 5.4 动画系统

使用 `motion/react`（Framer Motion 接口兼容）。

**自定义缓动曲线**（`src/lib/motion.ts`）：

```typescript
export const smoothBounce = [0.34, 1.56, 0.64, 1];  // 轻微回弹，页面切换
export const appleEase    = [0.25, 0.1, 0.25, 1.0];  // Apple HIG 标准缓动
```

**状态切换动画**（`ContentFade` 组件）：

```typescript
// AnimatePresence mode="wait" 保证旧内容完全离场后新内容才入场
<AnimatePresence mode="wait">
  <motion.div
    key={stateKey}          // stateKey 变化触发切换
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2, ease: smoothBounce }}
  />
</AnimatePresence>
```

**加载状态**（`LoadingState` 组件）：

```typescript
// 呼吸动画：opacity [0.4, 1, 0.4] 循环，2s 周期
animate={{ opacity: [0.4, 1, 0.4] }}
transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
```

`LoadingState` 有三种变体：`full`（全屏）、`area`（区块内居中）、`inline`（行内）。

---

## 6. 关键数据流

### 6.1 笔记编辑与提交

```
用户打开 /admin/edit/:id
  │
  ├── 加载内容详情: GET /spaces/notes/items/:id?visibility=all
  └── 加载或创建草稿: GET /notes/items/:id/draft（失败时 PUT 创建）
         ↓
用户编辑（1.5s 无操作后触发）
  → PUT /spaces/notes/items/:id/draft { title, summary, bodyMarkdown, changeNote }
  → 服务端写入 MongoDB EditorDraft

用户粘贴图片
  → POST /spaces/notes/items/:id/draft-assets (multipart)
  → 服务端写入 MinIO draft-assets/{id}/{sanitized-name}
  → 返回 { path: '/api/v1/.../draft-assets/{name}' }
  → 编辑器 img src = 该代理 URL

用户按 ⌘S 打开提交对话框 → 确认提交
  → PUT /spaces/notes/items/:id { action:'commit', bodyMarkdown, ... }
  → 服务端 NoteViewService.saveContent():
      1. MinIO 草稿资源落盘到 Git assets 目录
      2. markdown 中草稿 URL 改写为 ./assets/{name}
      3. ContentGitService.commit() → git add && git commit
      4. MongoDB ContentItem.latestVersion := 新 commitHash
      5. MinIO 清理该 id 下所有对象
      6. MongoDB EditorDraft 删除
  → 前端提示成功，跳转或留在编辑页
```

### 6.2 发布与可见性

```
管理端点击「发布」
  → PUT /spaces/notes/items/:id/publish
  → 服务端: publishedVersion := latestVersion（仅更新 MongoDB 指针）
  → 无 Git 操作，无新 commit

展示端请求内容
  → GET /spaces/notes/items/:id（无 JWT）
  → 服务端 visibility=public：读 publishedVersion.commitHash
  → Git: git show {commitHash}:content/{id}/body.md
  → 返回内容（publishedVersion 对应的历史快照）
```

### 6.3 版本时间旅行

```
管理端点击历史版本条目
  → GET /spaces/notes/items/:id/versions/:commitHash
  → 服务端: git show {commitHash}:content/{id}/body.md
  → 返回历史版本快照（只读）

前端以只读模式展示历史正文
（不影响当前草稿和 latestVersion）
```

### 6.4 画廊浏览

```
GET /spaces/gallery/items?status=published
  → GalleryViewService.toPostDto():
      - 读取 NavigationNode（scope=gallery）
      - 读取 ContentItem
      - 读取 assets 目录（取第一张作为封面）
      - 组装 PostDto { id, title, coverUrl, photoCount }

GET /spaces/gallery/items/:id
  → GalleryViewService.toPostDetailDto():
      - 读取 ContentItem + 版本正文
      - 读取 assets 目录（全部照片）
      - 组装 PostDetailDto { ..., photos: PhotoDto[] }

前端画廊页
  → 上下滑切换动态 (postIdx)
  → 左右滑翻照片 (photoIdx)
  → 方向感知动画（方向 → 初始/退出 translate 方向）
```

---

## 7. 部署与配置

### 7.1 环境变量（服务端必须）

```bash
ADMIN_PASSWORD=<明文密码>     # 单用户登录密码
JWT_SECRET=<随机字符串>       # JWT 签名密钥，建议 32+ 字符随机串
NODE_ENV=production           # 生产/开发模式
PORT=4398                     # 服务监听端口（可选，默认 3000）
LOG_LEVEL=info                # Pino 日志级别
```

### 7.2 配置文件（`configs/db.yaml`）

```yaml
mongo:
  host: localhost
  port: 27017
  username: admin
  password: your_password
  database: liminal-field
  options:
    authSource: admin
    ssl: false

content:
  repoRoot: /path/to/liminal-field-kb   # Git 知识库根目录（必须存在）

minio:
  endpoint: localhost
  port: 9000
  accessKey: minioadmin
  secretKey: minioadmin
  bucket: draft-assets
  useSSL: false
```

### 7.3 外部依赖

| 服务 | 用途 | 必需 |
|------|------|------|
| MongoDB | 元数据存储 | 是 |
| Git | 内容版本控制（本地，自动初始化） | 是 |
| MinIO | 草稿资源临时存储 | 否（降级运行） |
| Git Remote | 内容备份 / 同步 | 否（可选） |

**启动 MinIO（Docker）**：

```bash
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -v minio-data:/data \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

MinIO 控制台访问：`http://localhost:9001`

### 7.4 启动命令

```bash
# 服务端
cd liminal-field-server
pnpm install
pnpm start:dev              # 开发（watch mode）
pnpm build && pnpm start:prod  # 生产

# 前端
cd liminal-field-web
pnpm install
pnpm dev                    # 开发（Vite HMR，代理到 :4398）
pnpm build                  # 生产编译到 dist/
```

---

## 8. 关键设计决策

### 8.1 为什么用 Git 做版本控制而不是数据库

数据库版本化（在同一条记录里追加历史）会导致：
- 字段无限增长
- 正文无法做 diff
- 历史无法独立检出

Git 天然提供内容 diff、历史不可变性、分支管理。MongoDB 只存"指针"（commitHash），两者各司其职，互不侵入。

### 8.2 为什么 Publish 不创建新 Git commit

"发布"是一个可见性概念，不是内容变更。如果 publish 也产生 commit，版本历史会被可见性操作污染，语义不清晰。

一句话：**Git 历史 = 内容历史，publishedVersion = 可见性快照指针**。

### 8.3 为什么用 MinIO 而不是直接写 Git

草稿期间图片随时可能被丢弃。写入 Git 后要"撤销"需要 revert commit，破坏历史的线性性。MinIO 作为临时存储，commit 时才物化为 Git 资产，discard 时直接删除，清晰干净。

额外好处：MinIO 未来可以扩展为其他类型临时文件的存储（附件预览、临时导出等）。

### 8.4 为什么 MongoDB 不存正文

正文属于内容，内容的归宿是 Git。如果 MongoDB 也存一份正文：
- 两个存储之间需要同步，产生一致性问题
- MongoDB 文档大小有限制（16MB），长文章受限
- 查询成本随内容增长线性增加

MongoDB 只存"如何找到内容"（指针 + 元数据），实际内容永远在 Git。

### 8.5 为什么单用户而不做完整账号系统

项目定位是个人内容管理系统，多用户会带来权限模型、账号管理、数据隔离等大量复杂度。单用户通过环境变量配置密码，架构最简，安全性足够（bcrypt + JWT httpOnly cookie）。

### 8.6 Scope 隔离设计

Notes 和 Gallery 在存储层（NavigationNode、ContentItem）通过 `scope` 字段隔离，共享同一套 CRUD 逻辑。新增业务模块的步骤：

1. 在 `NavigationScope` 枚举中添加值
2. 根据需要添加 ViewService（如 `BookViewService`）
3. 在 Controller 添加特化端点（如需要）

存储层、API 路由、认证机制全部零改动。

---

*文档由项目代码反推生成，与实现保持同步。如有更新请同步修改此文件。*
