# 画廊管理端改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将画廊管理端从三栏布局改造为朋友圈 Feed 流 + 独立编辑页，修复 changeNote 保存报错，增加照片说明/拖拽排序/地点标签/Plate 随笔编辑/自动保存草稿。

**Architecture:** 后端新增 `GalleryPostMeta` MongoDB collection 存储画廊专属元数据（标签、照片说明、排序、封面），前端废弃三栏布局，改为 Feed 列表页 + 独立编辑页两个路由。随笔编辑复用 Plate 最小化插件配置，草稿机制复用 `editor_drafts` collection。

**Tech Stack:** NestJS 11 + TypeGoose + MongoDB (后端), React 19 + Plate 53 + dnd-kit + shadcn/ui + Tailwind 4 (前端)

**设计 Spec:** `docs/superpowers/specs/2026-05-02-gallery-admin-redesign.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `server/src/modules/workspace/gallery-post-meta.entity.ts` | GalleryPostMeta MongoDB entity（标签、照片元数据、封面） |
| `server/src/modules/workspace/gallery-post-meta.repository.ts` | GalleryPostMeta CRUD |
| `server/src/modules/workspace/dto/update-gallery-meta.dto.ts` | 更新画廊元数据的请求 DTO |
| `client/src/components/editor/gallery-editor-kit.ts` | Plate 最小化插件配置（加粗/斜体/下划线/删除线/链接/列表/缩进） |
| `client/src/pages/admin/gallery/components/GalleryFeedCard.tsx` | Feed 列表中的单条动态卡片 |
| `client/src/pages/admin/gallery/components/PhotoGrid.tsx` | 照片缩略图网格 + dnd-kit 拖拽排序 |
| `client/src/pages/admin/gallery/components/PhotoEditModal.tsx` | 照片详情编辑弹窗（shadcn Dialog） |
| `client/src/pages/admin/gallery/components/LocationSelect.tsx` | 地点下拉选择（shadcn Popover + Command） |
| `client/src/pages/admin/gallery/components/GalleryProseEditor.tsx` | 随笔 Plate 编辑器（工具栏 + 300 字限制） |
| `client/src/pages/admin/gallery/edit.tsx` | 画廊编辑页（新建/编辑共用） |
| `client/src/pages/admin/gallery/hooks/useGalleryEditor.ts` | 编辑页状态管理 + 自动保存草稿 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/src/modules/workspace/workspace.module.ts` | 注册 GalleryPostMeta entity + repository |
| `server/src/modules/workspace/workspace.controller.ts` | 新增画廊元数据 + 草稿路由 |
| `server/src/modules/workspace/gallery-view.service.ts` | 合并 GalleryPostMeta 到 DTO 输出 |
| `server/src/modules/workspace/dto/gallery-view.dto.ts` | DTO 增加 tags/captions/coverPhotoFileName 字段 |
| `client/src/services/workspace.ts` | galleryApi 新增接口 + 类型更新 |
| `client/src/pages/admin/gallery/index.tsx` | 从三栏布局改为 Feed 列表页 |
| `client/src/App.tsx` | 注册画廊编辑页路由 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `client/src/pages/admin/gallery/components/PostDetail.tsx` | 被编辑页 + Feed 卡片取代 |
| `client/src/pages/admin/gallery/components/PostList.tsx` | 被 Feed 列表取代 |
| `client/src/pages/admin/gallery/hooks/useGalleryWorkspace.ts` | 被 useGalleryEditor 取代 |

---

## Task 1: 修复 changeNote 保存报错

**Files:**
- Modify: `client/src/services/workspace.ts:328-332`

- [ ] **Step 1: 修改 galleryApi.update — 映射 description→bodyMarkdown + 补充 changeNote**

前端用 `description` 但后端 `UpdateWorkspaceItemDto` 的字段名是 `bodyMarkdown`，需要映射：

```ts
// client/src/services/workspace.ts — galleryApi.update
update: (id: string, dto: UpdateGalleryPostDto) =>
  request<GalleryPost>(`/spaces/gallery/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: dto.title,
      bodyMarkdown: dto.description !== undefined
        ? (dto.description || '\u200B')
        : undefined,
      changeNote: '更新画廊动态',
    }),
  }),
```

- [ ] **Step 2: 同步修改 galleryApi.create — 映射 description→bodyMarkdown + 补充 changeNote**

```ts
// client/src/services/workspace.ts — galleryApi.create
create: (dto: CreateGalleryPostDto) =>
  request<GalleryPost>('/spaces/gallery/items', {
    method: 'POST',
    body: JSON.stringify({
      title: dto.title,
      bodyMarkdown: dto.description || '\u200B',
      changeNote: '创建画廊动态',
    }),
  }),
```

- [ ] **Step 3: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add client/src/services/workspace.ts
git commit -m "fix: galleryApi 补充 changeNote 字段修复保存报错"
```

---

## Task 2: 后端 — GalleryPostMeta entity + repository

**Files:**
- Create: `server/src/modules/workspace/gallery-post-meta.entity.ts`
- Create: `server/src/modules/workspace/gallery-post-meta.repository.ts`
- Modify: `server/src/modules/workspace/workspace.module.ts`

- [ ] **Step 1: 创建 GalleryPostMeta entity**

```ts
// server/src/modules/workspace/gallery-post-meta.entity.ts
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

/**
 * GalleryPhotoMeta — 单张照片的元数据。
 * fileName 对应 Git assets/ 目录下的文件名，是照片的唯一标识。
 */
export class GalleryPhotoMeta {
  @prop({ required: true })
  fileName!: string;

  @prop({ default: '' })
  caption!: string;

  @prop({ required: true })
  order!: number;
}

/**
 * GalleryPostMeta — 画廊动态的专属元数据。
 *
 * 与 ContentItem 通过 contentItemId 关联，存储照片说明、排序、
 * 标签等画廊特有信息。照片文件本身仍在 Git 仓库中管理。
 */
@modelOptions({
  schemaOptions: { collection: 'gallery_post_meta', timestamps: true },
  options: { allowMixed: Severity.ALLOW },
})
export class GalleryPostMeta {
  @prop({ required: true, unique: true, index: true })
  contentItemId!: string;

  @prop({ type: () => [GalleryPhotoMeta], default: [] })
  photos!: GalleryPhotoMeta[];

  @prop({ default: null })
  coverPhotoFileName!: string | null;

  @prop({ type: () => Object, default: {} })
  tags!: Record<string, string>;

  createdAt!: Date;
  updatedAt!: Date;
}
```

- [ ] **Step 2: 创建 GalleryPostMeta repository**

```ts
// server/src/modules/workspace/gallery-post-meta.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@m8a/nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import { GalleryPostMeta } from './gallery-post-meta.entity';

@Injectable()
export class GalleryPostMetaRepository {
  constructor(
    @InjectModel(GalleryPostMeta)
    private readonly model: ReturnModelType<typeof GalleryPostMeta>,
  ) {}

  async findByContentItemId(
    contentItemId: string,
  ): Promise<GalleryPostMeta | null> {
    return this.model.findOne({ contentItemId }).lean().exec();
  }

  /**
   * upsert：不存在则创建，存在则更新指定字段。
   * 用于照片上传后自动初始化、编辑页保存元数据等场景。
   */
  async upsert(
    contentItemId: string,
    update: Partial<
      Pick<GalleryPostMeta, 'photos' | 'coverPhotoFileName' | 'tags'>
    >,
  ): Promise<GalleryPostMeta> {
    const result = await this.model
      .findOneAndUpdate(
        { contentItemId },
        { $set: update, $setOnInsert: { contentItemId } },
        { upsert: true, new: true, lean: true },
      )
      .exec();
    return result!;
  }

  async deleteByContentItemId(contentItemId: string): Promise<void> {
    await this.model.deleteOne({ contentItemId }).exec();
  }
}
```

- [ ] **Step 3: 注册到 WorkspaceModule**

在 `server/src/modules/workspace/workspace.module.ts` 中：

```ts
// 新增 import
import { GalleryPostMeta } from './gallery-post-meta.entity';
import { GalleryPostMetaRepository } from './gallery-post-meta.repository';

// imports 数组中添加
TypegooseModule.forFeature([EditorDraft, GalleryPostMeta]),

// providers 数组中添加
GalleryPostMetaRepository,
```

- [ ] **Step 4: 编译检查**

Run: `cd liminal-field/server && pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/workspace/gallery-post-meta.entity.ts \
        server/src/modules/workspace/gallery-post-meta.repository.ts \
        server/src/modules/workspace/workspace.module.ts
git commit -m "feat: 新增 GalleryPostMeta entity 和 repository"
```

---

## Task 3: 后端 — 更新画廊 DTO + ViewService

**Files:**
- Modify: `server/src/modules/workspace/dto/gallery-view.dto.ts`
- Modify: `server/src/modules/workspace/gallery-view.service.ts`
- Create: `server/src/modules/workspace/dto/update-gallery-meta.dto.ts`

- [ ] **Step 1: 更新 Gallery DTO，增加新字段**

```ts
// server/src/modules/workspace/dto/gallery-view.dto.ts

export class GalleryPhotoDto {
  id: string;        // = fileName
  url: string;
  fileName: string;
  size: number;
  order: number;
  caption: string;   // 新增：照片说明
}

export class GalleryPostDto {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  coverUrl: string | null;
  photoCount: number;
  tags: Record<string, string>;        // 新增：标签 { location: '北京' }
  coverPhotoFileName: string | null;   // 新增：手动封面
  previewPhotoUrls: string[];          // 新增：前 9 张照片 URL，Feed 卡片网格用
  createdAt: string;
  updatedAt: string;
}

export class GalleryPostDetailDto extends GalleryPostDto {
  photos: GalleryPhotoDto[];
}
```

- [ ] **Step 2: 创建更新元数据 DTO**

```ts
// server/src/modules/workspace/dto/update-gallery-meta.dto.ts
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PhotoMetaItemDto {
  @IsString()
  fileName!: string;

  @IsString()
  caption!: string;

  order!: number;
}

export class UpdateGalleryMetaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhotoMetaItemDto)
  @IsOptional()
  photos?: PhotoMetaItemDto[];

  @IsString()
  @IsOptional()
  coverPhotoFileName?: string | null;

  @IsObject()
  @IsOptional()
  tags?: Record<string, string>;
}
```

- [ ] **Step 3: 更新 GalleryViewService，合并元数据**

在 `gallery-view.service.ts` 中注入 `GalleryPostMetaRepository`，在 `toPostDto` 和 `toPostDetailDto` 中合并元数据：

```ts
// gallery-view.service.ts — 构造函数增加注入
constructor(
  private readonly contentRepository: ContentRepository,
  private readonly contentRepoService: ContentRepoService,
  private readonly galleryPostMetaRepository: GalleryPostMetaRepository,
) {}

// toPostDto — 合并 meta
async toPostDto(contentItemId: string): Promise<GalleryPostDto> {
  // ... 现有逻辑保持不变 ...
  const meta = await this.galleryPostMetaRepository.findByContentItemId(contentItemId);

  // 封面逻辑：优先用手动指定的封面，否则用第一张照片
  let coverUrl = firstImageUrl; // 现有逻辑推导的
  if (meta?.coverPhotoFileName) {
    coverUrl = this.buildPhotoUrl(contentItemId, meta.coverPhotoFileName);
  }

  return {
    // ... 现有字段 ...
    tags: meta?.tags ?? {},
    coverPhotoFileName: meta?.coverPhotoFileName ?? null,
    coverUrl,
  };
}

// toPostDetailDto — 照片合并 caption + order
async toPostDetailDto(contentItemId: string): Promise<GalleryPostDetailDto> {
  const post = await this.toPostDto(contentItemId);
  const assets = await this.contentRepoService.listAssets(contentItemId);
  const meta = await this.galleryPostMetaRepository.findByContentItemId(contentItemId);

  const imageAssets = assets.filter((a) => a.type === 'image');
  const photos: GalleryPhotoDto[] = imageAssets.map((asset, index) => {
    const photoMeta = meta?.photos.find((p) => p.fileName === asset.fileName);
    return {
      id: asset.fileName,
      url: this.buildPhotoUrl(contentItemId, asset.fileName),
      fileName: asset.fileName,
      size: asset.size,
      order: photoMeta?.order ?? index,
      caption: photoMeta?.caption ?? '',
    };
  });

  // 按 order 排序
  photos.sort((a, b) => a.order - b.order);

  return { ...post, photos };
}

// 新增：更新元数据
async updateMeta(
  contentItemId: string,
  dto: UpdateGalleryMetaDto,
): Promise<GalleryPostDetailDto> {
  const update: Record<string, unknown> = {};
  if (dto.photos !== undefined) update.photos = dto.photos;
  if (dto.coverPhotoFileName !== undefined) update.coverPhotoFileName = dto.coverPhotoFileName;
  if (dto.tags !== undefined) update.tags = dto.tags;

  await this.galleryPostMetaRepository.upsert(contentItemId, update);
  return this.toPostDetailDto(contentItemId);
}
```

- [ ] **Step 4: 编译检查**

Run: `cd liminal-field/server && pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/workspace/dto/gallery-view.dto.ts \
        server/src/modules/workspace/dto/update-gallery-meta.dto.ts \
        server/src/modules/workspace/gallery-view.service.ts
git commit -m "feat: gallery DTO 增加 tags/caption/cover 字段，ViewService 合并元数据"
```

---

## Task 4: 后端 — 画廊专属 Controller 路由

**Files:**
- Modify: `server/src/modules/workspace/workspace.controller.ts`

注意：NestJS 路由按注册顺序匹配。画廊特有路由必须在通用 `:scope` 路由之前注册（和 notes 特有路由同理）。

- [ ] **Step 1: 在 controller 中添加画廊特有路由**

在 notes 特有路由之后、通用 CRUD 之前，添加：

```ts
// ─── Gallery 特有路由 ───

/** 获取/更新画廊元数据（标签、照片排序/说明、封面） */
@Get('gallery/items/:id/meta')
async getGalleryMeta(@Param('id') id: string) {
  return this.galleryViewService.toPostDetailDto(id);
}

@Put('gallery/items/:id/meta')
async updateGalleryMeta(
  @Param('id') id: string,
  @Body() dto: UpdateGalleryMetaDto,
) {
  return this.galleryViewService.updateMeta(id, dto);
}

/** 画廊草稿：复用 editor_drafts 机制 */
@Get('gallery/items/:id/draft')
async getGalleryDraft(@Param('id') id: string): Promise<EditorDraftDto> {
  return this.noteViewService.getDraft(id);
}

@Put('gallery/items/:id/draft')
async saveGalleryDraft(
  @Param('id') id: string,
  @Body() dto: SaveDraftDto,
): Promise<EditorDraftDto> {
  return this.noteViewService.saveDraft(id, dto);
}

@Delete('gallery/items/:id/draft')
async deleteGalleryDraft(@Param('id') id: string): Promise<void> {
  return this.noteViewService.deleteDraft(id);
}
```

添加 import：
```ts
import { UpdateGalleryMetaDto } from './dto/update-gallery-meta.dto';
```

- [ ] **Step 2: 编译检查**

Run: `cd liminal-field/server && pnpm build`
Expected: 编译通过

- [ ] **Step 3: 运行单元测试**

Run: `cd liminal-field/server && npx jest --passWithNoTests`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add server/src/modules/workspace/workspace.controller.ts
git commit -m "feat: 画廊专属路由——元数据 CRUD + 草稿存取"
```

---

## Task 5: 前端 — 更新 galleryApi 服务层

**Files:**
- Modify: `client/src/services/workspace.ts`

- [ ] **Step 1: 更新类型定义**

在 Gallery 类型区域更新/新增：

```ts
// ─── Gallery 类型 ───

export interface GalleryPost {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  coverUrl: string | null;
  photoCount: number;
  tags: Record<string, string>;
  coverPhotoFileName: string | null;
  previewPhotoUrls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GalleryPhoto {
  id: string;
  url: string;
  fileName: string;
  size: number;
  order: number;
  caption: string;
}

export interface GalleryPostDetail extends GalleryPost {
  photos: GalleryPhoto[];
}

export interface CreateGalleryPostDto {
  title: string;
  description: string;
}

export interface UpdateGalleryPostDto {
  title?: string;
  description?: string;
}

/** 照片元数据项，用于批量更新排序/说明 */
export interface PhotoMetaItem {
  fileName: string;
  caption: string;
  order: number;
}

/** 画廊元数据更新 */
export interface UpdateGalleryMetaDto {
  photos?: PhotoMetaItem[];
  coverPhotoFileName?: string | null;
  tags?: Record<string, string>;
}
```

- [ ] **Step 2: galleryApi 新增接口**

```ts
export const galleryApi = {
  // ... 保留现有方法（create/list/getById/update/remove/uploadPhoto/deletePhoto/publish/unpublish）...

  /** 获取画廊元数据（含照片排序/说明/标签/封面） */
  getMeta: (id: string) =>
    request<GalleryPostDetail>(`/spaces/gallery/items/${id}/meta`),

  /** 更新画廊元数据 */
  updateMeta: (id: string, dto: UpdateGalleryMetaDto) =>
    request<GalleryPostDetail>(`/spaces/gallery/items/${id}/meta`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** 获取画廊草稿 */
  getDraft: (id: string) =>
    request<EditorDraft>(`/spaces/gallery/items/${id}/draft`),

  /** 保存画廊草稿 */
  saveDraft: (id: string, dto: SaveDraftDto) =>
    request<EditorDraft>(`/spaces/gallery/items/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** 删除画廊草稿 */
  deleteDraft: (id: string) =>
    request<void>(`/spaces/gallery/items/${id}/draft`, { method: 'DELETE' }),
};
```

- [ ] **Step 3: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add client/src/services/workspace.ts
git commit -m "feat: galleryApi 新增元数据/草稿接口和类型"
```

---

## Task 6: 前端 — Gallery Plate 编辑器套件

**Files:**
- Create: `client/src/components/editor/gallery-editor-kit.ts`

- [ ] **Step 1: 创建最小化 Plate 插件配置**

查看 `client/src/components/editor/editor-kit.tsx` 中各 Kit 的来源，然后创建只包含所需插件的 gallery 版本：

```ts
// client/src/components/editor/gallery-editor-kit.ts

/**
 * GalleryEditorKit — 画廊随笔专用的 Plate 插件配置。
 *
 * 只保留基础文本格式，不含标题/代码块/表格/图片/日期等重型插件，
 * 适配 300 字短文的编辑场景。
 *
 * 包含：加粗、斜体、下划线、删除线、超链接、有序/无序列表、缩进
 * 不含：标题层级、图片/媒体、代码块、表格、引用、日期、拖拽、字体颜色
 */
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
} from '@udecode/plate-basic-marks/react';
import { ParagraphPlugin } from '@udecode/plate/react';
import { LinkPlugin } from '@udecode/plate-link/react';
import {
  BulletedListPlugin,
  NumberedListPlugin,
  ListItemPlugin,
} from '@udecode/plate-list/react';
import { IndentPlugin } from '@udecode/plate-indent/react';
import { MarkdownPlugin } from '@udecode/plate-markdown';
import { TrailingBlockPlugin } from '@udecode/plate-trailing-block';

export const GalleryEditorKit = [
  // 基础段落
  ParagraphPlugin,

  // 行内格式
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,

  // 超链接
  LinkPlugin.configure({ options: { forceSubmit: true } }),

  // 列表
  BulletedListPlugin,
  NumberedListPlugin,
  ListItemPlugin,

  // 缩进
  IndentPlugin.configure({
    inject: { targetPlugins: [ParagraphPlugin.key, BulletedListPlugin.key, NumberedListPlugin.key] },
  }),

  // Markdown 序列化
  MarkdownPlugin,

  // 末尾保留空行
  TrailingBlockPlugin,
];
```

注意：以上 import 路径需要与项目中 `editor-kit.tsx` 的实际 import 保持一致。实现时先读 `editor-kit.tsx` 确认各插件的确切 import 路径。

- [ ] **Step 2: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add client/src/components/editor/gallery-editor-kit.ts
git commit -m "feat: GalleryEditorKit 最小化 Plate 插件配置"
```

---

## Task 7: 前端 — Feed 列表页

**Files:**
- Create: `client/src/pages/admin/gallery/components/GalleryFeedCard.tsx`
- Rewrite: `client/src/pages/admin/gallery/index.tsx`

- [ ] **Step 1: 创建 GalleryFeedCard 组件**

```tsx
// client/src/pages/admin/gallery/components/GalleryFeedCard.tsx

/**
 * GalleryFeedCard — Feed 列表中的单条动态卡片。
 *
 * 布局：标题行（标题 + 状态 badge + ⋯菜单）→ 照片网格 → 随笔截断 → 底部元信息
 * 照片网格：1 张 16:9 满宽，2 张两列，3+ 张三列。
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MoreHorizontal } from 'lucide-react';
import type { GalleryPost } from '@/services/workspace';

export function GalleryFeedCard({
  post,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  post: GalleryPost;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}) {
  const isPublished = post.status === 'published';

  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{
        background: 'var(--paper)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {/* Header: title + status + menu */}
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="text-base font-semibold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          {post.title}
        </h3>
        <div className="flex items-center gap-2">
          <StatusBadge status={post.status} />
          <PostMenu
            isPublished={isPublished}
            onEdit={onEdit}
            onPublish={onPublish}
            onUnpublish={onUnpublish}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* Photo grid */}
      {post.coverUrl && <PhotoPreviewGrid post={post} />}

      {/* Description truncated */}
      {post.description && (
        <p
          className="mb-2.5 line-clamp-2 text-sm leading-relaxed"
          style={{ color: 'var(--ink-light)' }}
        >
          {post.description}
        </p>
      )}

      {/* Footer: location + time + count */}
      <div className="flex items-center gap-2.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
        {post.tags?.location && (
          <span
            className="rounded-full px-2.5 py-0.5"
            style={{ background: 'var(--shelf)' }}
          >
            📍 {post.tags.location}
          </span>
        )}
        <span>{formatRelativeTime(post.createdAt)}</span>
        <span>·</span>
        <span>{post.photoCount} 张照片</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isPublished = status === 'published';
  return (
    <span
      className="rounded px-2 py-0.5 text-2xs font-medium"
      style={{
        background: isPublished ? 'rgba(52,199,89,0.1)' : 'rgba(255,159,10,0.1)',
        color: isPublished ? 'var(--mark-green)' : '#ff9f0a',
      }}
    >
      {isPublished ? '已发布' : '草稿'}
    </span>
  );
}

function PostMenu({ isPublished, onEdit, onPublish, onUnpublish, onDelete }: {
  isPublished: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded p-1 transition-colors hover:bg-[var(--shelf)]">
            <MoreHorizontal size={16} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>编辑</DropdownMenuItem>
          <DropdownMenuItem onClick={isPublished ? onUnpublish : onPublish}>
            {isPublished ? '取消发布' : '发布'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <AlertDialogTrigger asChild>
            <DropdownMenuItem className="text-[var(--mark-red)]">删除</DropdownMenuItem>
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>删除后无法恢复，确认要删除这条动态吗？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 照片预览网格：1 张 16:9 满宽，2 张两列，3+ 张三列 */
function PhotoPreviewGrid({ post }: { post: GalleryPost }) {
  const urls = post.previewPhotoUrls;
  if (!urls.length) return null;

  const cols = urls.length === 1 ? 1 : urls.length === 2 ? 2 : 3;
  const displayUrls = urls.slice(0, cols === 3 ? 9 : urls.length);

  return (
    <div
      className="mb-3 grid gap-1 overflow-hidden rounded-lg"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {displayUrls.map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          className="w-full object-cover"
          style={{ aspectRatio: cols === 1 ? '16/9' : '1' }}
        />
      ))}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}
```

- [ ] **Step 2: 重写 Feed 列表页**

```tsx
// client/src/pages/admin/gallery/index.tsx

/**
 * GalleryAdmin — 画廊管理 Feed 列表页。
 *
 * 朋友圈风格的单列 Feed 流，顶部筛选 + 新建按钮。
 * 每条动态通过 ⋯ 菜单操作（编辑/发布/删除）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import Topbar from '@/components/global/Topbar';
import { galleryApi } from '@/services/workspace';
import type { GalleryPost } from '@/services/workspace';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { GalleryFeedCard } from './components/GalleryFeedCard';

type StatusFilter = 'all' | 'draft' | 'published';

const FILTER_LABELS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
];

export default function GalleryAdmin() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      setPosts(await galleryApi.list(status));
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);

  const handlePublish = async (id: string) => {
    await galleryApi.publish(id);
    toast.success('已发布');
    void loadPosts();
  };

  const handleUnpublish = async (id: string) => {
    await galleryApi.unpublish(id);
    toast.success('已取消发布');
    void loadPosts();
  };

  const handleDelete = async (id: string) => {
    await galleryApi.remove(id);
    toast.success('已删除');
    void loadPosts();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Topbar />
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--shelf)' }}>
        {/* 操作栏 */}
        <div
          className="mx-auto flex max-w-[600px] items-center justify-between px-4 pt-6 pb-3"
        >
          <div className="flex gap-0.5">
            {FILTER_LABELS.map((f) => (
              <button
                key={f.key}
                className="rounded-md px-3 py-1.5 text-xs transition-colors duration-150"
                style={{
                  fontWeight: statusFilter === f.key ? 500 : 400,
                  background: statusFilter === f.key ? 'var(--ink)' : 'transparent',
                  color: statusFilter === f.key ? 'var(--paper)' : 'var(--ink-ghost)',
                }}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            className="rounded-lg px-4 py-1.5 text-xs font-medium"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            onClick={() => navigate('/admin/gallery/new')}
          >
            + 新建动态
          </button>
        </div>

        {/* Feed 列表 */}
        <div className="mx-auto max-w-[600px] px-4 pb-10">
          <ContentFade stateKey={loading && posts.length === 0 ? 'loading' : 'list'}>
            {loading && posts.length === 0 ? (
              <LoadingState />
            ) : posts.length === 0 ? (
              <div className="py-16 text-center text-sm" style={{ color: 'var(--ink-ghost)' }}>
                暂无动态
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {posts.map((post) => (
                  <GalleryFeedCard
                    key={post.id}
                    post={post}
                    onEdit={() => navigate(`/admin/gallery/edit/${post.id}`)}
                    onPublish={() => void handlePublish(post.id)}
                    onUnpublish={() => void handleUnpublish(post.id)}
                    onDelete={() => void handleDelete(post.id)}
                  />
                ))}
              </div>
            )}
          </ContentFade>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/gallery/components/GalleryFeedCard.tsx \
        client/src/pages/admin/gallery/index.tsx
git commit -m "feat: 画廊管理 Feed 列表页替换三栏布局"
```

---

## Task 8: 前端 — PhotoGrid 拖拽排序组件

**Files:**
- Create: `client/src/pages/admin/gallery/components/PhotoGrid.tsx`

- [ ] **Step 1: 安装 dnd-kit（如未安装）**

先检查：`cd liminal-field/client && cat package.json | grep dnd-kit`

如果没有 `@dnd-kit/core` 和 `@dnd-kit/sortable`：

Run: `cd liminal-field/client && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

注意：Plate 的 DndKit 是 `@udecode/plate-dnd`，不是 `@dnd-kit/sortable`，两者不同。

- [ ] **Step 2: 创建 PhotoGrid 组件**

```tsx
// client/src/pages/admin/gallery/components/PhotoGrid.tsx

/**
 * PhotoGrid — 照片缩略图网格 + dnd-kit 拖拽排序。
 *
 * 5 列网格，每张照片可拖拽调整顺序。
 * 有说明的照片右下角显示"说明"标记。
 * 末尾显示"+"上传按钮。
 * 点击照片触发 onPhotoClick 回调（打开 PhotoEditModal）。
 */

import { useRef } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { GalleryPhoto } from '@/services/workspace';

export function PhotoGrid({
  photos,
  onReorder,
  onPhotoClick,
  onUpload,
}: {
  photos: GalleryPhoto[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onPhotoClick: (index: number) => void;
  onUpload: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = photos.findIndex((p) => p.id === active.id);
    const toIndex = photos.findIndex((p) => p.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) onReorder(fromIndex, toIndex);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) onUpload(Array.from(e.target.files));
    e.target.value = '';
  };

  return (
    <div>
      <div
        className="mb-2.5 text-2xs font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
      >
        照片{' '}
        <span className="font-normal normal-case tracking-normal" style={{ color: 'var(--ink-ghost)' }}>
          — 拖拽调整顺序 · 点击编辑
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-5 gap-1.5">
            {photos.map((photo, i) => (
              <SortablePhoto
                key={photo.id}
                photo={photo}
                onClick={() => onPhotoClick(i)}
              />
            ))}

            {/* Upload button */}
            <button
              className="flex aspect-square items-center justify-center rounded-md"
              style={{ border: '1.5px dashed var(--separator)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="text-lg" style={{ color: 'var(--ink-ghost)' }}>+</span>
            </button>
          </div>
        </SortableContext>
      </DndContext>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}

function SortablePhoto({
  photo,
  onClick,
}: {
  photo: GalleryPhoto;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative aspect-square cursor-grab overflow-hidden rounded-md"
      onClick={(e) => {
        /* 拖拽结束后的 click 不触发 modal */
        if (!isDragging) onClick();
        e.stopPropagation();
      }}
    >
      <img
        src={photo.url}
        alt={photo.fileName}
        className="h-full w-full object-cover"
        draggable={false}
      />
      {/* 有说明标记 */}
      {photo.caption && (
        <span
          className="absolute bottom-1 right-1 rounded px-1 py-px text-[9px]"
          style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
        >
          说明
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/gallery/components/PhotoGrid.tsx
git commit -m "feat: PhotoGrid 拖拽排序照片网格"
```

---

## Task 9: 前端 — PhotoEditModal 组件

**Files:**
- Create: `client/src/pages/admin/gallery/components/PhotoEditModal.tsx`

- [ ] **Step 1: 创建 PhotoEditModal**

```tsx
// client/src/pages/admin/gallery/components/PhotoEditModal.tsx

/**
 * PhotoEditModal — 照片详情编辑弹窗。
 *
 * 左侧：暗底大图预览 + 照片切换箭头 + 计数。
 * 右侧：文件信息（一行）→ 说明 textarea → 底部操作（删除/设封面/完成）。
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { GalleryPhoto } from '@/services/workspace';

export function PhotoEditModal({
  open,
  photos,
  initialIndex,
  onClose,
  onCaptionChange,
  onSetCover,
  onDelete,
}: {
  open: boolean;
  photos: GalleryPhoto[];
  initialIndex: number;
  onClose: () => void;
  onCaptionChange: (photoId: string, caption: string) => void;
  onSetCover: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  /* initialIndex 变化时同步（打开新照片时） */
  useEffect(() => { setCurrentIndex(initialIndex); }, [initialIndex]);

  if (!photos.length) return null;
  const photo = photos[currentIndex];
  if (!photo) return null;

  const goNext = () => setCurrentIndex((i) => Math.min(i + 1, photos.length - 1));
  const goPrev = () => setCurrentIndex((i) => Math.max(i - 1, 0));

  /* 文件大小格式化 */
  const fileSize = photo.size > 1048576
    ? `${(photo.size / 1048576).toFixed(1)} MB`
    : `${Math.round(photo.size / 1024)} KB`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="flex overflow-hidden p-0"
        style={{
          maxWidth: 600,
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {/* 左：大图预览 */}
        <div
          className="relative flex w-[320px] shrink-0 items-center justify-center"
          style={{ background: '#111' }}
        >
          <img
            src={photo.url}
            alt={photo.fileName}
            className="max-h-[420px] w-full object-contain"
          />

          {/* 计数 */}
          <span
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl px-2.5 py-0.5 text-2xs"
            style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.7)' }}
          >
            {currentIndex + 1} / {photos.length}
          </span>

          {/* 切换箭头 */}
          {currentIndex > 0 && (
            <button
              className="absolute left-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}
              onClick={goPrev}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          {currentIndex < photos.length - 1 && (
            <button
              className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}
              onClick={goNext}
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {/* 右：信息面板 */}
        <div className="flex min-h-[420px] flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3.5">
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              照片详情
            </span>
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--shelf)]"
              onClick={onClose}
            >
              <X size={14} style={{ color: 'var(--ink-ghost)' }} />
            </button>
          </div>

          <div className="mx-5 h-px" style={{ background: 'var(--separator)' }} />

          {/* 文件信息（一行） */}
          <div className="px-5 pt-3.5">
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              文件
            </div>
            <div className="flex gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
              <span>{photo.fileName}</span>
              <span>·</span>
              <span>{fileSize}</span>
            </div>
          </div>

          {/* 说明 */}
          <div className="flex-1 px-5 pt-4">
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              说明
            </div>
            <textarea
              className="w-full resize-none rounded-lg border px-3.5 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--shelf)',
                border: '1px solid var(--separator)',
                color: 'var(--ink-light)',
                minHeight: 80,
                lineHeight: 1.6,
                fontFamily: 'var(--font-sans)',
              }}
              placeholder="为这张照片添加说明..."
              value={photo.caption}
              onChange={(e) => onCaptionChange(photo.id, e.target.value)}
            />
          </div>

          {/* 底部操作 */}
          <div className="px-5 pb-5">
            <div className="mb-3.5 h-px" style={{ background: 'var(--separator)' }} />
            <div className="flex items-center justify-between">
              <button
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--mark-red)' }}
                onClick={() => onDelete(photo.id)}
              >
                删除照片
              </button>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--shelf)]"
                  style={{ borderColor: 'var(--separator)', color: 'var(--ink-light)' }}
                  onClick={() => onSetCover(photo.id)}
                >
                  设为封面
                </button>
                <button
                  className="rounded-lg px-3.5 py-1.5 text-xs font-medium"
                  style={{ background: 'var(--ink)', color: 'var(--paper)' }}
                  onClick={onClose}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/gallery/components/PhotoEditModal.tsx
git commit -m "feat: PhotoEditModal 照片详情编辑弹窗"
```

---

## Task 10: 前端 — LocationSelect 组件

**Files:**
- Create: `client/src/pages/admin/gallery/components/LocationSelect.tsx`

- [ ] **Step 1: 创建 LocationSelect**

```tsx
// client/src/pages/admin/gallery/components/LocationSelect.tsx

/**
 * LocationSelect — 地点下拉选择。
 *
 * 低调的药丸样式，底部角落显示。使用 shadcn Popover + Command。
 * 固定选项列表，可留空（选择"无"清除）。
 */

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

const LOCATIONS = ['北京', '武汉', '青岛', '东京', '大理'];

export function LocationSelect({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (location: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors"
          style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
        >
          <span>📍</span>
          <span>{value || '添加地点'}</span>
          <span style={{ color: 'var(--ink-ghost)' }}>▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[160px] p-1" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => { onChange(undefined); setOpen(false); }}
                  className="text-xs"
                  style={{ color: 'var(--ink-ghost)' }}
                >
                  清除
                </CommandItem>
              )}
              {LOCATIONS.map((loc) => (
                <CommandItem
                  key={loc}
                  onSelect={() => { onChange(loc); setOpen(false); }}
                  className="text-xs"
                >
                  {loc === value ? `✓ ${loc}` : loc}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/gallery/components/LocationSelect.tsx
git commit -m "feat: LocationSelect 地点下拉选择组件"
```

---

## Task 11: 前端 — GalleryProseEditor 组件

**Files:**
- Create: `client/src/pages/admin/gallery/components/GalleryProseEditor.tsx`

- [ ] **Step 1: 创建 GalleryProseEditor**

复用 `PlateMarkdownEditor` 的模式（`usePlateEditor` + `deserializeMd` / `serializeMd`），但使用 `GalleryEditorKit`。

```tsx
// client/src/pages/admin/gallery/components/GalleryProseEditor.tsx

/**
 * GalleryProseEditor — 画廊随笔 Plate 编辑器。
 *
 * 最小化工具栏（加粗/斜体/下划线/删除线/链接/列表/缩进），
 * 300 字限制 + 字数计数。底层使用 GalleryEditorKit 插件配置。
 */

import { useCallback, useMemo } from 'react';
import {
  Plate,
  usePlateEditor,
  type PlateEditor,
} from '@udecode/plate/react';
import { serializeMd, deserializeMd } from '@udecode/plate-markdown';
import { MarkdownPlugin } from '@udecode/plate-markdown';
import { GalleryEditorKit } from '@/components/editor/gallery-editor-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { Toolbar, ToolbarGroup } from '@/components/ui/toolbar';
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button';
import { LinkToolbarButton } from '@/components/ui/link-toolbar-button';
import { ListToolbarButton } from '@/components/ui/list-toolbar-button';
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
} from '@udecode/plate-basic-marks/react';
import {
  BulletedListPlugin,
  NumberedListPlugin,
} from '@udecode/plate-list/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  ListOrdered,
} from 'lucide-react';

const CHAR_LIMIT = 300;

export function GalleryProseEditor({
  initialMarkdown,
  onChange,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}) {
  const editor = usePlateEditor({
    plugins: GalleryEditorKit,
    value: (e) => deserializeMd(e, initialMarkdown),
  });

  const handleChange = useCallback(() => {
    const md = serializeMd(editor);
    onChange(md);
  }, [editor, onChange]);

  /* 字数统计：取纯文本长度 */
  const charCount = useMemo(() => {
    const text = editor.api.string([]);
    return text.length;
  }, [editor]);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div
          className="text-2xs font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
        >
          随笔
        </div>
        <div
          className="text-2xs"
          style={{ color: charCount > CHAR_LIMIT ? 'var(--mark-red)' : 'var(--ink-ghost)' }}
        >
          {charCount} / {CHAR_LIMIT}
        </div>
      </div>

      <Plate editor={editor} onValueChange={handleChange}>
        {/* 工具栏 */}
        <Toolbar
          className="rounded-t-[10px] border border-b-0 px-2.5 py-1.5"
          style={{
            background: 'var(--paper)',
            borderColor: 'var(--separator)',
          }}
        >
          <ToolbarGroup>
            <MarkToolbarButton nodeType={BoldPlugin.key} tooltip="加粗">
              <Bold size={14} />
            </MarkToolbarButton>
            <MarkToolbarButton nodeType={ItalicPlugin.key} tooltip="斜体">
              <Italic size={14} />
            </MarkToolbarButton>
            <MarkToolbarButton nodeType={UnderlinePlugin.key} tooltip="下划线">
              <Underline size={14} />
            </MarkToolbarButton>
            <MarkToolbarButton nodeType={StrikethroughPlugin.key} tooltip="删除线">
              <Strikethrough size={14} />
            </MarkToolbarButton>
          </ToolbarGroup>

          <ToolbarGroup>
            <LinkToolbarButton />
          </ToolbarGroup>

          <ToolbarGroup>
            <ListToolbarButton nodeType={BulletedListPlugin.key}>
              <List size={14} />
            </ListToolbarButton>
            <ListToolbarButton nodeType={NumberedListPlugin.key}>
              <ListOrdered size={14} />
            </ListToolbarButton>
          </ToolbarGroup>
        </Toolbar>

        {/* 编辑区域 */}
        <EditorContainer
          className="rounded-b-[10px] border border-t-0"
          style={{ borderColor: 'var(--separator)' }}
        >
          <Editor
            className="min-h-[100px] px-3.5 py-3 text-sm"
            style={{ color: 'var(--ink-light)', lineHeight: 1.7 }}
            placeholder="写点什么..."
          />
        </EditorContainer>
      </Plate>
    </div>
  );
}
```

注意：`usePlateEditor`、`serializeMd`、`deserializeMd`、工具栏组件的确切 import 路径需要与项目现有代码一致。实现时先读 `PlateEditor.tsx` 和 `fixed-toolbar-buttons.tsx` 确认。

- [ ] **Step 2: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/admin/gallery/components/GalleryProseEditor.tsx
git commit -m "feat: GalleryProseEditor 随笔 Plate 编辑器"
```

---

## Task 12: 前端 — 画廊编辑页 + 自动保存 + 路由注册

**Files:**
- Create: `client/src/pages/admin/gallery/hooks/useGalleryEditor.ts`
- Create: `client/src/pages/admin/gallery/edit.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: 创建 useGalleryEditor hook**

```ts
// client/src/pages/admin/gallery/hooks/useGalleryEditor.ts

/**
 * useGalleryEditor — 画廊编辑页状态管理 + 自动保存。
 *
 * 核心职责：
 * 1. 加载动态详情 + 元数据（或初始化新建空状态）
 * 2. 管理编辑中的 title/prose/tags/photos 状态
 * 3. 1500ms debounce 自动保存随笔草稿到 editor_drafts
 * 4. 照片/标签/封面变更即时保存到 gallery_post_meta
 * 5. 手动保存 = 提交随笔到 Git + 删除草稿
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { arrayMove } from '@dnd-kit/sortable';
import { galleryApi } from '@/services/workspace';
import type {
  GalleryPostDetail,
  GalleryPhoto,
  PhotoMetaItem,
} from '@/services/workspace';

type SaveStatus = 'saved' | 'dirty' | 'saving';

export function useGalleryEditor(postId: string | undefined) {
  /* 是否新建模式 */
  const isNew = !postId;

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [coverPhotoFileName, setCoverPhotoFileName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);

  /* 实际使用的 ID（新建后拿到的 ID） */
  const effectiveId = postId ?? createdPostId;

  /* ─── 初始化加载 ─── */
  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    void loadPost(postId);
  }, [postId, isNew]);

  const loadPost = async (id: string) => {
    setLoading(true);
    try {
      const detail = await galleryApi.getById(id);
      setTitle(detail.title);
      setProse(detail.description);
      setPhotos(detail.photos);
      setTags(detail.tags);
      setCoverPhotoFileName(detail.coverPhotoFileName);

      /* 尝试恢复草稿 */
      try {
        const draft = await galleryApi.getDraft(id);
        if (draft) {
          setProse(draft.bodyMarkdown === '\u200B' ? '' : draft.bodyMarkdown);
          setTitle(draft.title);
        }
      } catch {
        /* 无草稿，用正式版本 */
      }
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  /* ─── 自动保存随笔草稿（1500ms debounce） ─── */
  const draftTimerRef = useRef<number>();

  useEffect(() => {
    if (!effectiveId || saveStatus !== 'dirty') return;
    draftTimerRef.current = window.setTimeout(() => {
      void saveDraft();
    }, 1500);
    return () => window.clearTimeout(draftTimerRef.current);
  }, [saveStatus, effectiveId, title, prose]);

  const saveDraft = useCallback(async () => {
    if (!effectiveId) return;
    setSaveStatus('saving');
    try {
      await galleryApi.saveDraft(effectiveId, {
        title,
        summary: title,
        bodyMarkdown: prose || '\u200B',
        changeNote: '自动保存',
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('dirty');
    }
  }, [effectiveId, title, prose]);

  /* ─── 标记脏状态 ─── */
  const markDirty = useCallback(() => setSaveStatus('dirty'), []);

  const updateTitle = useCallback((v: string) => { setTitle(v); markDirty(); }, [markDirty]);
  const updateProse = useCallback((v: string) => { setProse(v); markDirty(); }, [markDirty]);

  /* ─── 元数据即时保存（标签/封面/照片排序和说明） ─── */
  const saveMetaImmediate = useCallback(async (
    photosToSave: GalleryPhoto[],
    tagsToSave: Record<string, string>,
    coverToSave: string | null,
  ) => {
    if (!effectiveId) return;
    const photoMeta: PhotoMetaItem[] = photosToSave.map((p, i) => ({
      fileName: p.fileName,
      caption: p.caption,
      order: i,
    }));
    await galleryApi.updateMeta(effectiveId, {
      photos: photoMeta,
      tags: tagsToSave,
      coverPhotoFileName: coverToSave,
    });
  }, [effectiveId]);

  /* ─── 照片操作 ─── */
  const reorderPhotos = useCallback(async (fromIndex: number, toIndex: number) => {
    const newPhotos = arrayMove(photos, fromIndex, toIndex);
    setPhotos(newPhotos);
    await saveMetaImmediate(newPhotos, tags, coverPhotoFileName);
  }, [photos, tags, coverPhotoFileName, saveMetaImmediate]);

  const updateCaption = useCallback(async (photoId: string, caption: string) => {
    const newPhotos = photos.map((p) =>
      p.id === photoId ? { ...p, caption } : p,
    );
    setPhotos(newPhotos);
    /* caption 延迟保存而不是每次按键都存——但为简化起见，先即时保存 */
    await saveMetaImmediate(newPhotos, tags, coverPhotoFileName);
  }, [photos, tags, coverPhotoFileName, saveMetaImmediate]);

  const uploadPhotos = useCallback(async (files: File[]) => {
    if (!effectiveId) return;
    for (const file of files) {
      try {
        await galleryApi.uploadPhoto(effectiveId, file);
      } catch {
        toast.error(`上传失败: ${file.name}`);
      }
    }
    /* 重新加载照片列表 */
    const detail = await galleryApi.getById(effectiveId);
    setPhotos(detail.photos);
  }, [effectiveId]);

  const deletePhoto = useCallback(async (photoId: string) => {
    if (!effectiveId) return;
    await galleryApi.deletePhoto(effectiveId, photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    if (coverPhotoFileName === photoId) setCoverPhotoFileName(null);
  }, [effectiveId, coverPhotoFileName]);

  const setCover = useCallback(async (photoId: string) => {
    const fileName = photos.find((p) => p.id === photoId)?.fileName ?? null;
    setCoverPhotoFileName(fileName);
    await saveMetaImmediate(photos, tags, fileName);
    toast.success('已设为封面');
  }, [photos, tags, saveMetaImmediate]);

  /* ─── 标签操作 ─── */
  const updateLocation = useCallback(async (location: string | undefined) => {
    const newTags = { ...tags };
    if (location) {
      newTags.location = location;
    } else {
      delete newTags.location;
    }
    setTags(newTags);
    await saveMetaImmediate(photos, newTags, coverPhotoFileName);
  }, [tags, photos, coverPhotoFileName, saveMetaImmediate]);

  /* ─── 手动保存（提交到 Git） ─── */
  const save = useCallback(async () => {
    if (!effectiveId) return;
    try {
      await galleryApi.update(effectiveId, { title, description: prose });
      /* 删除草稿 */
      try { await galleryApi.deleteDraft(effectiveId); } catch { /* ignore */ }
      setSaveStatus('saved');
      toast.success('已保存');
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [effectiveId, title, prose]);

  /* ─── 新建动态 ─── */
  const createPost = useCallback(async (): Promise<string | null> => {
    try {
      const post = await galleryApi.create({ title, description: prose });
      setCreatedPostId(post.id);
      toast.success('已创建');
      return post.id;
    } catch (e) {
      toast.error(`创建失败: ${e instanceof Error ? e.message : '未知错误'}`);
      return null;
    }
  }, [title, prose]);

  return {
    loading,
    isNew,
    effectiveId,
    title,
    prose,
    photos,
    tags,
    coverPhotoFileName,
    saveStatus,
    updateTitle,
    updateProse,
    reorderPhotos,
    updateCaption,
    uploadPhotos,
    deletePhoto,
    setCover,
    updateLocation,
    save,
    createPost,
  };
}
```

- [ ] **Step 2: 创建编辑页**

```tsx
// client/src/pages/admin/gallery/edit.tsx

/**
 * GalleryEditPage — 画廊动态编辑页（新建/编辑共用）。
 *
 * 顶部：← 标题（可编辑）+ 自动保存状态 + 保存按钮
 * 内容：照片网格 → 随笔编辑器 → 地点标签
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Topbar from '@/components/global/Topbar';
import { useGalleryEditor } from './hooks/useGalleryEditor';
import { PhotoGrid } from './components/PhotoGrid';
import { PhotoEditModal } from './components/PhotoEditModal';
import { GalleryProseEditor } from './components/GalleryProseEditor';
import { LocationSelect } from './components/LocationSelect';
import { LoadingState } from '@/components/LoadingState';

export default function GalleryEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editor = useGalleryEditor(id);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhotoIndex, setModalPhotoIndex] = useState(0);

  if (editor.loading) return <LoadingState variant="full" />;

  const handlePhotoClick = (index: number) => {
    setModalPhotoIndex(index);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (editor.isNew) {
      const newId = await editor.createPost();
      if (newId) navigate(`/admin/gallery/edit/${newId}`, { replace: true });
    } else {
      await editor.save();
    }
  };

  const saveStatusText: Record<string, string> = {
    saved: '✓ 已自动保存',
    dirty: '● 有未保存的更改',
    saving: '↻ 保存中...',
  };
  const saveStatusColor: Record<string, string> = {
    saved: 'var(--mark-green)',
    dirty: '#ff9f0a',
    saving: 'var(--ink-ghost)',
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Topbar />

      {/* 顶部导航栏 */}
      <div
        className="flex items-center justify-between px-6 py-3.5"
        style={{ borderBottom: '0.5px solid var(--separator)' }}
      >
        <div className="flex items-center gap-2">
          <button
            className="rounded p-0.5 transition-colors hover:bg-[var(--shelf)]"
            onClick={() => navigate('/admin/gallery')}
          >
            <ChevronLeft size={18} style={{ color: 'var(--ink-faded)' }} />
          </button>
          <input
            type="text"
            value={editor.title}
            onChange={(e) => editor.updateTitle(e.target.value)}
            className="border-none bg-transparent text-base font-semibold outline-none"
            style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
            placeholder="动态标题"
          />
        </div>
        <div className="flex items-center gap-3">
          {!editor.isNew && (
            <span className="text-2xs" style={{ color: saveStatusColor[editor.saveStatus] }}>
              {saveStatusText[editor.saveStatus]}
            </span>
          )}
          <button
            className="rounded-lg px-4 py-1.5 text-xs font-medium"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            onClick={() => void handleSave()}
          >
            {editor.isNew ? '创建' : '保存'}
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[520px] px-4 py-7">

          {/* 照片网格 */}
          <div className="mb-7">
            <PhotoGrid
              photos={editor.photos}
              onReorder={editor.reorderPhotos}
              onPhotoClick={handlePhotoClick}
              onUpload={(files) => void editor.uploadPhotos(files)}
            />
          </div>

          {/* 随笔编辑器 */}
          <div className="mb-7">
            <GalleryProseEditor
              initialMarkdown={editor.prose}
              onChange={editor.updateProse}
            />
          </div>

          {/* 地点标签 */}
          <LocationSelect
            value={editor.tags.location}
            onChange={(loc) => void editor.updateLocation(loc)}
          />
        </div>
      </div>

      {/* 照片编辑弹窗 */}
      <PhotoEditModal
        open={modalOpen}
        photos={editor.photos}
        initialIndex={modalPhotoIndex}
        onClose={() => setModalOpen(false)}
        onCaptionChange={(photoId, caption) => void editor.updateCaption(photoId, caption)}
        onSetCover={(photoId) => void editor.setCover(photoId)}
        onDelete={(photoId) => {
          void editor.deletePhoto(photoId);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: 注册路由**

在 `client/src/App.tsx` 中：

```tsx
// 添加 lazy import
const GalleryEditPage = lazy(() => import('./pages/admin/gallery/edit'));

// 在 AdminShell 的子路由中添加
<Route path="gallery/edit/:id" element={<Suspense fallback={<LoadingState variant="full" />}><GalleryEditPage /></Suspense>} />
<Route path="gallery/new" element={<Suspense fallback={<LoadingState variant="full" />}><GalleryEditPage /></Suspense>} />
```

注意：`gallery/edit/:id` 和 `gallery/new` 是 `/admin` 下的子路由，渲染在 AdminShell 的 `<Outlet />` 中。

- [ ] **Step 4: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/gallery/hooks/useGalleryEditor.ts \
        client/src/pages/admin/gallery/edit.tsx \
        client/src/App.tsx
git commit -m "feat: 画廊编辑页 + 自动保存 + 路由注册"
```

---

## Task 13: 清理旧组件

**Files:**
- Delete: `client/src/pages/admin/gallery/components/PostDetail.tsx`
- Delete: `client/src/pages/admin/gallery/components/PostList.tsx`
- Delete: `client/src/pages/admin/gallery/hooks/useGalleryWorkspace.ts`

- [ ] **Step 1: 确认无其他文件引用旧组件**

搜索 `PostDetail`、`PostList`、`useGalleryWorkspace` 的引用：

Run: `cd liminal-field/client && grep -r "PostDetail\|PostList\|useGalleryWorkspace" src/ --include="*.ts" --include="*.tsx" -l`

Expected: 只应出现在待删文件自身中。如果 `index.tsx` 还引用了旧组件，确认 Task 7 已正确重写。

- [ ] **Step 2: 删除旧文件**

```bash
rm client/src/pages/admin/gallery/components/PostDetail.tsx \
   client/src/pages/admin/gallery/components/PostList.tsx \
   client/src/pages/admin/gallery/hooks/useGalleryWorkspace.ts
```

- [ ] **Step 3: 类型检查**

Run: `cd liminal-field/client && npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: 编译检查**

Run: `cd liminal-field/server && pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add -u client/src/pages/admin/gallery/
git commit -m "refactor: 移除画廊旧三栏布局组件"
```

---

## 验收检查清单

完成所有 Task 后，逐项验证：

1. [ ] **changeNote 报错**：编辑现有动态 → 保存成功，不报 changeNote 错误
2. [ ] **Feed 列表页**：`/admin/gallery` 显示朋友圈风格 Feed，有筛选和新建按钮
3. [ ] **新建动态**：点新建 → 跳转编辑页 → 填写标题/上传照片/写随笔 → 创建成功 → 列表可见
4. [ ] **编辑动态**：Feed 中点 ⋯ → 编辑 → 跳转编辑页 → 修改后保存成功
5. [ ] **照片拖拽排序**：在编辑页拖拽照片缩略图，松手后顺序变化并持久化
6. [ ] **照片 Modal**：点击缩略图 → 弹出大图 Modal → 可添加说明 → 可设为封面 → 可删除
7. [ ] **随笔编辑**：Plate 编辑器工具栏正常（加粗/斜体/下划线/删除线/链接/列表），300 字计数正确
8. [ ] **地点标签**：底部药丸可选择地点，Feed 列表中显示对应标签
9. [ ] **自动保存**：编辑随笔后停顿 1.5s，顶栏显示"✓ 已自动保存"
10. [ ] **发布/取消发布**：Feed 中通过 ⋯ 菜单操作，状态 badge 正确切换
11. [ ] **删除确认**：Feed 中删除有二次确认弹窗
12. [ ] **TypeScript**：`npx tsc -b --noEmit` 无错误
13. [ ] **Server build**：`pnpm build` 编译通过
