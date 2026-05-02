# 画廊 Frontmatter 协议重构

## Git 文件协议

```
ci_xxx/
├── main.md           ← frontmatter（照片元数据）+ 正文（随笔）
├── README.md         ← 自动生成
└── assets/
    ├── photo-a1b2c3d4.jpg
    └── photo-e5f6g7h8.png
```

### main.md 格式

```markdown
---
cover: photo-a1b2c3d4.jpg
tags:
  location: 北京
photos:
  - file: photo-a1b2c3d4.jpg
    caption: 老胡同里的光影
    tags:
      camera: GR III
  - file: photo-e5f6g7h8.png
    caption: ""
    tags: {}
---

随笔正文（Markdown）
```

- photos 数组顺序即排列顺序
- cover 可选，不设则无封面
- tags 可选，Post 级和 Photo 级各自独立
- file 即 assets/ 下的文件名

## MongoDB

| Collection | 用法 |
|---|---|
| `content_items` | 不改，latestVersion/publishedVersion/changeLogs |
| `navigation_nodes` | 不改，scope='gallery' |
| `editor_drafts` | bodyMarkdown 存完整 main.md（含 frontmatter） |
| ~~`gallery_post_meta`~~ | 删掉 |

## 业务操作 → 底层调用

| 业务操作 | 底层 |
|---|---|
| 提交 | 序列化 frontmatter+prose → bodyMarkdown → contentService.saveContent(action=commit) |
| 发布 | contentService.saveContent(action=publish)，纯指针 |
| 取消发布 | contentService.saveContent(action=unpublish)，清指针 |
| 存草稿 | 序列化 frontmatter+prose → bodyMarkdown → editorDraftRepository.save |
| 上传照片 | storeAsset → git commit |
| 删除照片 | 删文件 → git commit |

## 后端删除

- gallery-post-meta.entity.ts
- gallery-post-meta.repository.ts
- dto/update-gallery-meta.dto.ts
- Controller 中 meta 路由

## 后端修改

- GalleryViewService：重写，解析/序列化 frontmatter
- gallery-view.dto.ts：调整字段
- workspace.controller.ts：删 meta 路由
- workspace.module.ts：去掉 GalleryPostMeta 注册

## 前端依赖

- gray-matter：frontmatter 解析/序列化
