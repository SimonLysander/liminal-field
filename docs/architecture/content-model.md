# 统一内容架构设计

> 状态：设计中 | 创建：2026-05-18

---

## 核心原则

1. **MongoDB 是一手源，Git 是异步归档**——业务版本在 MongoDB 管理，ContentSnapshot 用 nanoid 生成的 `_id` 作为版本标识（`versionId`），与 Git 无关。Git commit 完成后异步回填 `commitHash`，该字段仅作归档凭证，不参与任何业务版本控制逻辑。正常业务永远不从 Git 读数据。
2. **所有 scope 的文件都有 frontmatter**——title 等元数据在 frontmatter 里，版本层的 title 是提取的副本
3. **bodyMarkdown = 一个文件的内容**——版本层不解析，业务层按文件协议解析
4. **索引 + 产物的统一模式**——Gallery 索引引用 OSS 里的照片，Anthology 索引引用 MongoDB snapshot 里的条目，读取模式一致
5. **编辑/查看/版本粒度是单篇**——Anthology 每篇条目有独立的 snapshot 链、草稿、版本历史，跟 Notes 单篇笔记的体验一致
6. **Anthology 两层发布**——先发布文集（上线），再发布单篇条目。文集未发布 = 读者完全看不到。条目未发布 = 读者在文集里看不到那篇

---

## 第一层：文件协议（Git 里长什么样）

### Notes

```
content/ci_note_abc/
├── main.md
└── assets/
```

```markdown
---
title: 线性方程组
---

设 Ax = b 是一个线性方程组...

![矩阵](./assets/matrix.png)
```

一个文件，frontmatter 只有 title。

### Gallery

```
content/ci_gallery_xyz/
├── main.md
└── assets/
    ├── photo-001.jpg
    └── photo-002.jpg
```

```markdown
---
title: 东湖闲逛
date: "2026-05-14"
location: 武汉
cover: photo-001.jpg
photos:
  - file: photo-001.jpg
    caption: 湖边小路
    tags: { aperture: "f/2.8", iso: "200" }
  - file: photo-002.jpg
    caption: 荷花
    tags: { aperture: "f/4", iso: "100" }
---

今天在东湖边闲逛，阳光很好。
```

main.md 是**索引**（照片列表 + 元数据）+ 随笔正文。**产物**（照片文件）在 assets/ 里。

### Anthology（文集）

```
content/ci_anthology_sea/
├── main.md
├── entries/
│   ├── e001.md
│   ├── e002.md
│   └── e003.md
└── assets/
```

**main.md**（索引）：
```markdown
---
title: 深海日记
description: 在深海中寻找微光的故事
entries:
  - key: e001
    title: 沉没
    date: 2026-05-01
    publishedVersionId: "snapshot-xxx"    # 已发布，冻结在这个版本
  - key: e002
    title: 漂流
    date: 2026-05-03
    publishedVersionId: null              # 未发布
  - key: e003
    title: 灯塔
    date: 2026-05-08
    publishedVersionId: null
---
```

**entries/e001.md**（条目）：
```markdown
---
title: 沉没
date: 2026-05-01
---

海面之下是另一个世界。那天我鼓起勇气潜入深海...
```

main.md 是**索引**（条目目录）。**产物**（各篇正文）在 entries/ 里。

### 四个 scope 的统一模式

| scope | main.md 是什么 | 产物是什么 | 产物在哪 |
|-------|---------------|-----------|---------|
| Notes | 正文本身 | 无 | — |
| Gallery | 索引（照片列表）+ 随笔 | 照片文件 | assets/（OSS） |
| Anthology | 索引（条目目录） | 各篇正文 | entries/（MongoDB snapshot） |
| Digest | 索引（事项容器） | 各期报告 | entries/（MongoDB snapshot） |

**Digest scope 说明**：Digest（智能简报）在文件结构上与 Anthology 同构——事项是容器（main.md），各期报告是子 entry。之所以不复用 anthology scope，是因为公开展示逻辑、管理入口、Aurora agent 类型以及发布语义与文集完全不同，业务必须严格隔离。详见 `server/src/modules/navigation/navigation.entity.ts` 中的注释。

---

## 第二层：版本存储（MongoDB）

### bodyMarkdown = 一个文件的内容

每个 ContentSnapshot.bodyMarkdown 存的是**一个文件**的内容，不多不少。

- Notes 的 snapshot：存 main.md 内容
- Gallery 的 snapshot：存 main.md 内容
- Anthology 的 main.md snapshot：存索引内容（不含条目正文）
- Anthology 的条目 snapshot：存那一篇的内容

### Anthology 需要多个 snapshot

Notes 和 Gallery 只有一个文件（main.md），一个 ContentItem 下一串 snapshot 就够了。

Anthology 有多个文件（main.md + entries/e001.md + entries/e002.md + ...）。每个文件各自有自己的 snapshot。

怎么区分一个 snapshot 是哪个文件的？**给 ContentSnapshot 加一个 `fileName` 字段**：

```
ContentSnapshot {
  ...已有字段不变...
  fileName: null | "entries/e001.md"    // null = main.md（默认）
}
```

### 数据示例

一个文集，3 篇，第一篇改过一次：

```
ContentItem ci_anthology_sea
  latestVersion → idx-v2（指向最新的 main.md snapshot）

// ── main.md 的 snapshot 链 ──
snapshot idx-v1   fileName=null              bodyMarkdown="---\ntitle: 深海日记\nentries: [{e001,沉没},{e002,漂流}]\n---"
snapshot idx-v2   fileName=null              bodyMarkdown="---\ntitle: 深海日记\nentries: [{e001,沉没},{e002,漂流},{e003,灯塔}]\n---"

// ── entries/e001.md 的 snapshot 链 ──
snapshot e001-v1  fileName="entries/e001.md"  bodyMarkdown="---\ntitle: 沉没\ndate: 2026-05-01\n---\n\n初稿..."
snapshot e001-v2  fileName="entries/e001.md"  bodyMarkdown="---\ntitle: 沉没\ndate: 2026-05-01\n---\n\n修改后..."

// ── entries/e002.md 的 snapshot 链 ──
snapshot e002-v1  fileName="entries/e002.md"  bodyMarkdown="---\ntitle: 漂流\ndate: 2026-05-03\n---\n\n第三天..."

// ── entries/e003.md 的 snapshot 链 ──
snapshot e003-v1  fileName="entries/e003.md"  bodyMarkdown="---\ntitle: 灯塔\ndate: 2026-05-08\n---\n\n远处的光..."
```

- 改第一篇 → 只产生 `fileName="entries/e001.md"` 的新 snapshot
- 加一篇 → 产生新条目 snapshot + 更新 main.md 的 snapshot
- `ContentItem.latestVersion` 指向 main.md（`fileName=null`）的最新 snapshot
- 每篇的最新版本通过查询获得

### Notes 和 Gallery

`fileName` 始终 `null`，行为跟现在一模一样。

### fileName 对版本层的影响

| 操作 | fileName=null | fileName 非 null |
|------|-------------|-----------------|
| 提交版本 | 新建 snapshot + 更新 latestVersion | 新建 snapshot，不更新 latestVersion |
| 查最新版本 | 查 fileName=null 的最新 | 查指定 fileName 的最新 |
| 版本历史 | 列出 fileName=null 的所有 | 列出指定 fileName 的所有 |
| 发布 | 不变 | 不变（发布逻辑由业务层组合） |

**latestVersion 只跟踪 main.md（fileName=null）。** 其他文件的最新版本通过查询。

新增索引：`{ contentItemId: 1, fileName: 1, createdAt: -1 }`

---

### EditorDraft 草稿隔离约定

草稿的 `_id` 不是 ObjectId，而是按业务语义拼接的确定性字符串：

- 单文件草稿（Notes/Gallery）：`"draft:{contentItemId}"`
- Anthology/Digest 条目草稿：`"draft:{contentItemId}:{fileName}"`（如 `"draft:ci_anthology_sea:entries/e001.md"`）

**设计意图**：同一内容同一文件同时只能有一份草稿（upsert 语义）。用确定性 `_id` 既避免了建额外唯一索引的开销，又让"按文件找草稿"降为 O(1) 主键查询，不需要跨 contentItemId + fileName 的复合索引。`fileName = null` 的约定保持了与原有 notes/gallery 逻辑的向后兼容。

详见 `server/src/modules/workspace/editor-draft.entity.ts`。

---

## 从零开始的完整生命周期

### Notes：新建 → 编辑 → 提交 → 发布

```
1. 新建笔记

   MongoDB：新建 ContentItem + 空 snapshot（fileName=null）+ NavigationNode(scope:"notes")
   Git：无


2. 写内容，自动保存草稿

   MongoDB：写入 EditorDraft（独立集合，跟 snapshot 无关）
   Git：无


3. 提交

   业务层：编辑器内容加上 frontmatter title → bodyMarkdown
   MongoDB：新建 snapshot（fileName=null, bodyMarkdown=完整 main.md 内容）→ latestVersion 指向它
   Git（异步）：bodyMarkdown 写到磁盘 main.md → git commit → 回填 commitHash


4. 发布

   MongoDB：publishedVersion 指向 latestVersion 的 snapshot（纯指针）
   Git：无
```

### Gallery：新建 → 编辑 → 提交

```
1. 新建相册

   跟 Notes 一样。


2. 上传照片、写随笔，提交

   业务层：photos/cover/date/location/prose → 按 Gallery 协议序列化成 bodyMarkdown
   MongoDB：新建 snapshot（fileName=null, bodyMarkdown=含 frontmatter 的 main.md 内容）
   Git（异步）：bodyMarkdown 写到磁盘 main.md

   跟 Notes 唯一区别：bodyMarkdown 里有更复杂的 frontmatter。版本层不知道。


3. 读取

   业务层：从 snapshot 拿 bodyMarkdown → 解析 frontmatter 得到 photos 列表 → 按 file 字段去 OSS 拿照片 → 返回 DTO
```

### Anthology：新建 → 添加条目 → 编辑条目 → 发布

```
1. 新建文集

   跟 Notes 一样。空索引。


2. 添加第一篇"沉没"

   业务层做了两件事：

   (a) 存条目文件
       bodyMarkdown = "---\ntitle: 沉没\ndate: 2026-05-01\n---\n\n海面之下..."
       新建 snapshot（fileName="entries/e001.md", bodyMarkdown=上面的内容）
       → latestVersion 不动（只跟踪 main.md）

   (b) 更新索引
       bodyMarkdown = "---\ntitle: 深海日记\n...\nentries:\n  - {key:e001, title:沉没, date:2026-05-01}\n---"
       新建 snapshot（fileName=null, bodyMarkdown=新索引内容）
       → latestVersion 指向新索引 snapshot

   Git（异步）：写 main.md + entries/e001.md → git commit


3. 添加第二篇"漂流"

   同上：存条目 snapshot（fileName="entries/e002.md"）+ 更新索引 snapshot


4. 编辑第一篇"沉没"

   业务层只做一件事：

   (a) 存条目新版本
       新建 snapshot（fileName="entries/e001.md", bodyMarkdown=修改后内容）

   如果 title/date 没变 → 索引不用动，结束
   如果 title/date 变了 → 额外更新索引 snapshot（改冗余字段）

   Git（异步）：写 entries/e001.md → git commit

   e002、e003 完全没碰。


5. 发布文集（上线）

   publishedVersion 指向当前索引 snapshot → 文集对读者可见
   但此时条目列表为空——还没有条目被发布


6. 发布某篇条目

   (a) 查该条目最新 snapshot 的 versionId
   (b) 更新索引 frontmatter：该条目的 publishedVersionId = versionId
   (c) 新建索引 snapshot → latestVersion 指向新索引
   (d) 如果文集已发布：同时更新 publishedVersion 指向新索引

   读者看到的是 publishedVersionId 对应的版本，不是最新编辑版本。
   作者后续编辑不影响已发布内容，直到再次发布那篇。


7. 批量发布所有条目

   对每篇条目执行步骤 6，一次性把所有条目的 publishedVersionId 设为最新。


8. 取消发布条目

   更新索引 frontmatter：该条目的 publishedVersionId = null → 读者看不到那篇


9. 取消发布文集（下线）

   publishedVersion = null → 读者完全看不到这个文集


6. 读取文集目录

   业务层：从索引 snapshot 拿 bodyMarkdown → 解析 frontmatter 得到 entries 列表
   → 直接返回（冗余的 title/date 够展示目录了，不需要查条目 snapshot）


7. 读取文集某一篇

   业务层：
   → 从索引确认条目存在 + 确定 prev/next
   → 按 fileName 查对应条目的 snapshot → 拿 bodyMarkdown → 解析 frontmatter + 正文 → 返回 DTO
```

---

## Git 归档与恢复

### 归档（MongoDB → Git）

```
Notes / Gallery：bodyMarkdown 直接写 main.md

Anthology：ViewService 拆成多文件
  ├── 索引 snapshot 的 bodyMarkdown → main.md
  └── 各条目 snapshot 的 bodyMarkdown → entries/e001.md, entries/e002.md, ...
      （每条的 bodyMarkdown 已经含自己的 frontmatter，直接写文件）
```

### 恢复（Git → MongoDB）

Git 仅作灾备。MongoDB 的 `bodyMarkdown` 本身即一手源，常规运营无需从 Git 重建。灾备恢复路径的语义与实现见相关代码，此处不展开。

---

## 数据模型变更

| 什么 | 改动 |
|------|------|
| ContentSnapshot | 加 `fileName: string \| null`（默认 null）+ 复合索引 |
| ContentItem | 不改 |
| ContentService | 加 `getLatestSnapshot(id, fileName?)` 和 `listVersions(id, fileName?)` |
| NavigationNode | scope 枚举加 `'anthology'` |

---

## 读取模式对比

四个 scope 的读取是一致的模式：**解析索引 → 按引用去拿产物**。

```
Notes：
  解析 main.md → 正文就在 bodyMarkdown 里，无需额外拿产物

Gallery：
  解析 main.md frontmatter → 得到 photos 列表
  → 按 file 字段去 OSS 拿照片文件

Anthology：
  解析 main.md frontmatter → 得到 entries 列表
  → 按 key 去 MongoDB 拿条目 snapshot（fileName="entries/{key}.md"）
```
