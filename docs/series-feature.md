# 连载功能设计文档

> 状态：💤 **暂缓 / 待实现**(设计完整,零代码,2026-06 暂缓) | 创建：2026-05-18
>
> 这份是「设计储备」——数据模型、API、UI 方案完整,要做连载功能时可直接照此实现。当前 server/client 均无对应代码。

## 一、背景与动机

当前笔记系统是扁平的独立文档结构，无法支撑两类需求：
- **连载小说**：严格章节顺序，连续叙事
- **随笔集/心思**：松散归组，主题相关

核心诉求：**一组笔记，有归属、有排序、有独立的阅读入口。**

## 二、核心设计决策

### 展示层独立，数据层复用

- Series（系列）是新的一级实体，与笔记、图集平级
- 章节就是 ContentItem，编辑器 / 版本管理 / 资产管理全部复用
- 属于系列的章节从笔记列表中过滤掉，不两边同时出现

```
Series（系列）
├── 章节 1  ← ContentItem（复用）
├── 章节 2  ← ContentItem（复用）
├── 章节 3  ← ContentItem（草稿，未发布）
└── ...
```

## 三、数据模型

### 新增：`series` 集合

```typescript
// server/src/modules/workspace/series.entity.ts

@ModelOptions({ schemaOptions: { collection: 'series', timestamps: true } })
class Series {
  @Prop({ default: () => nanoid() })
  _id: string;

  /** 系列标题 */
  @Prop({ required: true })
  title: string;

  /** 简介（纯文本或轻量 Markdown） */
  @Prop({ default: '' })
  description: string;

  /** 封面图 URL（可选） */
  @Prop()
  coverUrl?: string;

  /** 有序章节 ID 列表，顺序即章节顺序 */
  @Prop({ type: () => [String], default: [] })
  chapters: string[];   // ContentItem._id[]

  @Prop({ default: 'draft' })
  status: 'draft' | 'published';

  @Prop()
  publishedAt?: Date | null;

  createdAt: Date;   // timestamps: true
  updatedAt: Date;
  
  @Prop()
  createdBy?: string;

  @Prop()
  updatedBy?: string;
}
```

### 修改：ContentItem 加 `seriesId`

```typescript
// content-item.entity.ts 新增字段

/** 属于哪个系列，有值则从笔记列表过滤掉 */
@Prop({ type: String, required: false, index: true })
seriesId?: string;
```

**双向关联的理由：**
- `Series.chapters[]`：控制章节顺序，系列详情页一次查完
- `ContentItem.seriesId`：笔记列表过滤，`{ seriesId: { $exists: false } }` 即可

## 四、API 设计

路由前缀：`/api/v1/spaces/series`

### 展示端（公开）

| 方法 | 路径 | 说明 | 返回 |
|------|------|------|------|
| `GET` | `/series` | 已发布系列列表 | `SeriesListItem[]` |
| `GET` | `/series/:id` | 系列详情 + 章节目录 | `SeriesDetail` |
| `GET` | `/series/:id/chapters/:chapterId` | 章节正文 | `ChapterDetail`（含 prev/next） |

### 管理端（鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/series?status=all` | 全部系列（含草稿） |
| `POST` | `/series` | 创建系列 |
| `PUT` | `/series/:id` | 更新系列元数据（标题、简介、封面） |
| `DELETE` | `/series/:id` | 删除系列（章节解除归属，变回独立笔记） |
| `PUT` | `/series/:id/chapters` | 更新章节列表（增删、重排序） |
| `POST` | `/series/:id/chapters` | 新建章节（创建 ContentItem + 自动关联） |
| `PUT` | `/series/:id/publish` | 发布系列 |
| `PUT` | `/series/:id/unpublish` | 取消发布 |

章节内容编辑：**直接复用 `/spaces/notes/items/:id` 全套接口**（草稿、提交、资产上传）。

### DTO 定义

```typescript
/* ---------- 展示端 ---------- */

interface SeriesListItem {
  id: string;
  title: string;
  description: string;
  coverUrl?: string;
  chapterCount: number;
  totalWordCount: number;
  updatedAt: string;
}

interface SeriesDetail {
  id: string;
  title: string;
  description: string;
  coverUrl?: string;
  chapters: SeriesChapterItem[];
  createdAt: string;
  updatedAt: string;
}

interface SeriesChapterItem {
  id: string;
  title: string;
  wordCount: number;
  publishedAt?: string;
}

/** 章节正文，同 ContentDetail + 上下章导航 */
interface ChapterDetail {
  id: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  headings: { level: number; text: string }[];
  wordCount: number;
  publishedAt?: string;
  prev?: { id: string; title: string } | null;
  next?: { id: string; title: string } | null;
}

/* ---------- 管理端 ---------- */

interface SeriesAdminListItem extends SeriesListItem {
  status: 'draft' | 'published';
  hasUnpublishedChapters: boolean;
}

interface SeriesAdminDetail extends SeriesDetail {
  status: 'draft' | 'published';
  chapters: SeriesAdminChapterItem[];
}

interface SeriesAdminChapterItem extends SeriesChapterItem {
  status: 'committed' | 'published';
  hasDraft: boolean;
  updatedAt: string;
}

/* ---------- 首页 ---------- */

interface HomeSeriesItem {
  id: string;
  title: string;
  latestChapterTitle: string;
  updatedAt: string;
}

/** HomeData 扩展 */
interface HomeData {
  notes: HomeNoteItem[];
  series: HomeSeriesItem[];     // NEW
  gallery: GalleryPublicListItem[];
}
```

## 五、路由结构

### 展示端

```
/series                        → 系列列表
/series?id=xxx                 → 系列概览（封面+简介+目录）
/series?id=xxx&ch=yyy          → 章节阅读（正文+上下章导航）
```

与 `/note?doc=xxx`、`/gallery?post=xxx` 的 query param 模式一致。

### 管理端

```
/admin/series                  → 系列管理列表
/admin/series/:id/edit         → 系列编辑（元数据+章节管理）
/admin/notes/:id/edit          → 章节编辑（复用现有 Plate 编辑器）
```

## 六、UI 设计

### 1. Sidebar 导航

在笔记和画廊之间新增：

```typescript
spaces = [
  { id: 'home',    label: '首页', icon: Home,     path: '/home' },
  { id: 'notes',   label: '笔记', icon: FileText, path: '/note' },
  { id: 'series',  label: '连载', icon: BookOpen,  path: '/series' },  // NEW
  { id: 'gallery', label: '画廊', icon: Image,    path: '/gallery' },
];
```

Sub-nav 两级 drill-down（同笔记的文件夹钻入）：

```
Level 1 — 系列列表           Level 2 — 章节列表
┌─────────────────┐         ┌─────────────────┐
│ ← 连载          │         │ ← 深海日记       │
│─────────────────│         │─────────────────│
│ 📖 深海日记      │   →     │ 01 · 沉没        │
│ 📖 城市碎片      │         │ 02 · 漂流        │
│ 📖 技术周刊      │         │ 03 · 灯塔    ●   │  ← 当前
└─────────────────┘         │ 04 · 浮出        │
                            └─────────────────┘
```

### 2. 展示端 — 系列列表页 `/series`

竖排列表，每个系列一行：

```
┌────────────────────────────────────────┐
│                                        │
│  连载                                   │
│                                        │
│  ┌──────┐  深海日记                     │
│  │ 封面  │  12 章 · 3.2k 字 · 更新于今天  │
│  │      │  在深海中寻找微光的故事...       │
│  └──────┘                              │
│  ─────────────────────────────────     │
│  ┌──────┐  城市碎片                     │
│  │ 封面  │  8 篇 · 1.8k 字 · 5/12       │
│  │      │  都市生活的零碎记录...          │
│  └──────┘                              │
│                                        │
└────────────────────────────────────────┘
```

### 3. 展示端 — 系列概览 `/series?id=xxx`

```
┌────────────────────────────────────────┐
│                                        │
│  深海日记                               │
│  在深海中寻找微光的故事，关于失去与重新    │
│  找到方向。                              │
│                                        │
│  ┌─ 目录 ──────────────────────────┐   │
│  │ 01  沉没          1,200 字  5/1  │   │
│  │ 02  漂流            980 字  5/3  │   │
│  │ 03  灯塔          1,500 字  5/8  │   │
│  │ 04  浮出          1,100 字  5/12 │   │
│  └──────────────────────────────────┘   │
│                                        │
│           [ 开始阅读 ]                   │
│                                        │
└────────────────────────────────────────┘
```

### 4. 展示端 — 章节阅读 `/series?id=xxx&ch=yyy`

```
┌────────────────────────────────────────────────┐
│ 深海日记 › 第三章                      [目录]    │  ← 面包屑
│                                                │
│                  灯塔                           │
│          1,500 字 · 5 分钟 · 5/8               │
│                                                │
│  正文正文正文正文正文正文正文正文正文正文         │
│  正文正文正文正文正文正文正文正文...              │
│                                                │
│  ┌──────────────────────────────────────┐      │
│  │  ← 02 漂流          04 浮出 →        │      │  ← 上下章导航
│  └──────────────────────────────────────┘      │
└────────────────────────────────────────────────┘
```

阅读排版复用 NoteReader（serif 字体、阅读宽度、TOC），额外：
- 顶部面包屑（系列名 → 章节名）
- 底部上下章导航条
- 右侧 TOC 可切换"本章大纲"/"全部章节"

### 5. 首页 — "连载更新"板块

在"最近笔记"和"近期图集"之间：

```
最近笔记
├── ...

连载更新                          查看全部 →
├── 深海日记 · 新章「灯塔」         5/8
├── 城市碎片 · 新篇「雨天」         5/6

近期图集
├── ...
```

### 6. 管理端 — IconRail 新增

```typescript
NAV_ITEMS = [
  { path: '/admin/notes',    icon: FileText, label: '笔记管理' },
  { path: '/admin/series',   icon: BookOpen,  label: '连载管理' },  // NEW
  { path: '/admin/gallery',  icon: Image,     label: '画廊管理' },
  { path: '/admin/settings', icon: Settings,  label: '设置' },
];
```

### 7. 管理端 — 系列编辑页 `/admin/series/:id/edit`

```
┌──────────────────────────────────────────┐
│  ← 返回                    [发布] [保存]  │
│                                          │
│  标题：[深海日记                    ]     │
│  简介：[在深海中寻找微光的故事...    ]     │
│  封面：[上传/更换]                        │
│                                          │
│  ┌─ 章节管理 ────────────────────────┐   │
│  │ ≡ 01  沉没      已发布  [编辑]     │   │  ← 拖拽排序
│  │ ≡ 02  漂流      已发布  [编辑]     │   │
│  │ ≡ 03  灯塔      草稿    [编辑]     │   │
│  │                                    │   │
│  │         [ + 添加章节 ]              │   │
│  └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

点击"编辑" → `/admin/notes/:chapterId/edit`（复用 Plate 编辑器）。

## 七、发布逻辑

| 系列状态 | 章节状态 | 读者可见？ |
|----------|----------|-----------|
| published | published | 可见 |
| published | draft/committed | 不显示该章节（目录中隐藏） |
| draft | 任意 | 整个系列不可见 |

- 删除系列 → 章节解除 `seriesId`，变回独立笔记（不丢数据）
- 从系列移除章节 → 同上

## 八、实现优先级

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P0** | Series entity + API + ContentItem 加 seriesId + 笔记列表过滤 | 纯后端 |
| **P1** | 管理端：系列 CRUD + 章节管理页 | P0 |
| **P2** | 展示端：系列列表 + 概览 + 章节阅读 | P0 |
| **P3** | Sidebar 导航 + 首页板块 | P2 |
| **P4** | 润色：拖拽排序、封面上传、阅读进度（localStorage） | P1-P3 |

## 九、待讨论

- [ ] 系列封面：支持上传还是从章节内容自动提取？
- [ ] 章节编号：自动递增还是允许自定义（如"番外"、"序章"）？
- [ ] 是否需要"阅读进度"功能（localStorage 记住读到哪一章）？
- [ ] 随笔集和连载小说是否需要 `type` 字段区分（影响展示风格）？
