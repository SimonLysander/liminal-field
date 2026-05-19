/**
 * workspace.ts — 统一 workspace 服务层
 *
 * 背景：后端从分散的 gallery/editor/home 模块重构为统一的 WorkspaceModule，
 * 路由统一为 /spaces/:scope/items/... 格式。本文件取代原 content-items.ts 和 gallery.ts，
 * 对消费方保持相同的类型和 API 接口，只更新底层请求路径。
 *
 * 导出结构：
 *   - notesApi   — notes scope 专用（含草稿、历史、版本等），兼容原 contentItemsApi
 *   - galleryApi — gallery scope 专用，兼容原 galleryApi
 *   - workspaceApi — 通用 CRUD，供将来新 scope 复用
 */

import { request, toQueryString } from './request';

// ─── 共用类型（原 content-items.ts 导出，保持不变供消费方使用）───

export type ContentStatus = 'committed' | 'published';
export type ContentChangeType = 'patch' | 'major';
export type ContentAssetType = 'image' | 'audio' | 'video' | 'file';
export type ContentVisibility = 'public' | 'all';
export type ContentSaveAction = 'commit' | 'publish' | 'unpublish';

export interface ContentVersion {
  /** MongoDB snapshot ID，取代原 Git commitHash 成为主键 */
  versionId: string;
  commitHash: string;
  title: string;
  summary: string;
}

export interface ChangeLog {
  commitHash?: string;
  title?: string;
  summary?: string;
  createdAt: string;
  changeType: ContentChangeType;
  changeNote: string;
}

export interface ContentListItem {
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  hasUnpublishedChanges: boolean;
  latestChange?: ChangeLog;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export interface ContentDetail {
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  hasUnpublishedChanges: boolean;
  bodyMarkdown: string;
  /** 后端提取的 TOC 标题列表（level 1-3） */
  headings: { level: number; text: string }[];
  changeLogs: ChangeLog[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
}

export interface CreateContentDto {
  title: string;
  summary?: string;
  bodyMarkdown: string;
  changeNote?: string;
  changeType?: ContentChangeType;
  createdBy?: string;
}

export interface SaveContentDto {
  title: string;
  summary: string;
  status: ContentStatus;
  bodyMarkdown: string;
  changeNote: string;
  changeType?: ContentChangeType;
  action?: ContentSaveAction;
  updatedBy?: string;
}

export interface SaveDraftDto {
  title: string;
  summary: string;
  bodyMarkdown: string;
  changeNote: string;
  savedBy?: string;
}

export interface EditorDraft {
  id: string;
  contentItemId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  changeNote: string;
  savedAt: string;
  savedBy?: string;
}

export interface UploadedAsset {
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ListedAsset {
  path: string;
  fileName: string;
  type: ContentAssetType;
  size: number;
}

export interface ContentHistoryEntry {
  versionId: string;
  commitHash: string;
  committedAt: string;
  changeType: string;
  changeNote: string;
  /** 来源：'user' | 'system' | 'ai' | 'import' */
  source: string;
  title: string;
}

// ─── Gallery 类型（按消费场景拆分）───

/** 展示端画廊列表项（未登录用户） */
export interface GalleryPublicListItem {
  id: string;
  title: string;
  /** 封面图 URL，null 表示未设置。 */
  coverUrl: string | null;
  /** 照片数量 */
  photoCount: number;
  /** 帖子拍摄/发生日期（ISO 8601），null 表示未设置。 */
  date: string | null;
  /** 帖子地点，null 表示未设置。 */
  location: string | null;
  createdAt: string;
}

/** 展示端画廊详情（未登录用户） */
export interface GalleryPublicDetail {
  id: string;
  title: string;
  prose: string;
  photos: GalleryPhoto[];
  date: string | null;
  location: string | null;
  createdAt: string;
}

/** 管理端画廊列表项 */
export interface GalleryAdminListItem {
  id: string;
  title: string;
  status: 'committed' | 'published';
  coverUrl: string | null;
  photoCount: number;
  hasUnpublishedChanges: boolean;
  date: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 管理端画廊详情 */
export interface GalleryAdminDetail {
  id: string;
  title: string;
  prose: string;
  status: 'committed' | 'published';
  photos: GalleryPhoto[];
  /** 封面照片原始文件名，null 表示未设置 */
  coverPhotoFileName: string | null;
  hasUnpublishedChanges: boolean;
  /** 已发布版本 versionId（MongoDB snapshot ID），null 表示未发布 */
  publishedVersionId: string | null;
  date: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 编辑器照片（后端已合并草稿+正式版） */
export interface GalleryEditorPhoto {
  file: string;
  url: string;
  size: number;
  caption: string;
  tags: Record<string, string>;
}

/** 编辑器加载状态（GET /editor 端点返回，后端已合并草稿+正式版） */
export interface GalleryEditorState {
  id: string;
  title: string;
  prose: string;
  photos: GalleryEditorPhoto[];
  cover: string | null;
  date: string | null;
  location: string | null;
  hasDraft: boolean;
  draftSavedAt: string | null;
}

/** 照片展示类型（精简版，无 size/order） */
export interface GalleryPhoto {
  id: string;
  url: string;
  /** 原图 URL（无处理参数，Lightbox / 下载用） */
  originalUrl?: string;
  fileName: string;
  /** 文件大小（字节） */
  size: number;
  /** 照片说明文字，空字符串表示无说明 */
  caption: string;
  /** 照片级 key-value 标签，如 { location: '上海' } */
  tags: Record<string, string>;
}

export interface CreateGalleryPostDto {
  title: string;
  description: string;
}

/** 画廊专属的保存 DTO，与后端 SaveGalleryPostDto 对应。前端只发结构化 JSON，不知道 frontmatter。 */
export interface UpdateGalleryPostDto {
  title: string;
  prose: string;
  photos?: Array<{ file: string; caption: string; tags?: Record<string, string> }>;
  cover?: string | null;
  date?: string | null;
  location?: string | null;
  changeNote?: string;
}

/** 画廊历史版本的结构化响应（后端解析 frontmatter 后返回）。 */
export interface GalleryVersionContent {
  /** MongoDB snapshot ID，取代原 Git commitHash 成为主键 */
  versionId: string;
  title: string;
  prose: string;
  photos: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  cover: string | null;
  date: string | null;
  location: string | null;
}

/** 画廊草稿的结构化响应（后端反序列化 frontmatter 后返回，前端不接触 bodyMarkdown）。 */
export interface GalleryDraft {
  title: string;
  prose: string;
  photos: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  cover: string | null;
  date: string | null;
  location: string | null;
  savedAt: string;
}

// toQueryString 从 request.ts 统一导出，避免重复定义

// ─── workspaceApi — 通用 CRUD，scope 作为参数传入 ───

export const workspaceApi = {
  list: (scope: string, options?: { status?: string }) =>
    request<ContentListItem[]>(
      `/spaces/${scope}/items${toQueryString({ status: options?.status })}`,
    ),

  getById: (scope: string, id: string) =>
    request<ContentDetail>(`/spaces/${scope}/items/${id}`),

  create: (scope: string, dto: CreateContentDto) =>
    request<ContentDetail>(`/spaces/${scope}/items`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  update: (scope: string, id: string, dto: Partial<SaveContentDto>) =>
    request<ContentDetail>(`/spaces/${scope}/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  remove: (scope: string, id: string) =>
    request<void>(`/spaces/${scope}/items/${id}`, { method: 'DELETE' }),

  publish: (scope: string, id: string) =>
    request<ContentDetail>(`/spaces/${scope}/items/${id}/publish`, {
      method: 'PUT',
    }),

  unpublish: (scope: string, id: string) =>
    request<ContentDetail>(`/spaces/${scope}/items/${id}/unpublish`, {
      method: 'PUT',
    }),

  listAssets: (scope: string, id: string) =>
    request<ListedAsset[]>(`/spaces/${scope}/items/${id}/assets`),

  uploadAsset: (scope: string, id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<UploadedAsset>(`/spaces/${scope}/items/${id}/assets`, {
      method: 'POST',
      body: formData,
    });
  },
};

// ─── notesApi — notes scope 专用，兼容原 contentItemsApi 接口 ───

export const notesApi = {
  /** 按 ID 获取笔记详情，支持 visibility 过滤 */
  getById: (id: string, options?: { visibility?: ContentVisibility }) =>
    request<ContentDetail>(
      `/spaces/notes/items/${id}${toQueryString({ visibility: options?.visibility })}`,
    ),

  /** 列出笔记，支持 visibility / status 过滤 */
  list: (options?: {
    visibility?: ContentVisibility;
    status?: ContentStatus;
  }) =>
    request<ContentListItem[]>(
      `/spaces/notes/items${toQueryString({
        visibility: options?.visibility,
        status: options?.status,
      })}`,
    ),

  /** 创建新笔记（在 notes scope 下建 item） */
  create: (dto: CreateContentDto) =>
    request<ContentDetail>('/spaces/notes/items', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  /**
   * 正式保存（含版本化）。
   * 路由命中后端 PUT /spaces/notes/items/:id，
   * 走 NoteViewService.saveContent 完整版本化流程，非通用 update。
   */
  save: (id: string, dto: SaveContentDto) =>
    request<ContentDetail>(`/spaces/notes/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  getDraft: (id: string) =>
    request<EditorDraft | null>(`/spaces/notes/items/${id}/draft`),

  saveDraft: (id: string, dto: SaveDraftDto) =>
    request<EditorDraft>(`/spaces/notes/items/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  deleteDraft: (id: string) =>
    request<void>(`/spaces/notes/items/${id}/draft`, { method: 'DELETE' }),

  /** 发布。可选传 versionId 发布指定历史版本，不传则发布 latestVersion。 */
  publish: (id: string, versionId?: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/publish`, {
      method: 'PUT',
      body: versionId ? JSON.stringify({ versionId }) : undefined,
    }),

  unpublish: (id: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/unpublish`, { method: 'PUT' }),

  getByVersion: (id: string, versionId: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/versions/${versionId}`),

  /** 轻量更新元数据（摘要等），不创建新版本。 */
  patchMeta: (id: string, dto: { summary?: string }) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  getHistory: (id: string) =>
    request<ContentHistoryEntry[]>(`/spaces/notes/items/${id}/history`),

  listAssets: (id: string) =>
    request<ListedAsset[]>(`/spaces/notes/items/${id}/assets`),

  uploadAsset: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<UploadedAsset>(`/spaces/notes/items/${id}/assets`, {
      method: 'POST',
      body: formData,
    });
  },
};

// ─── galleryApi — gallery scope 专用 ───

export const galleryApi = {
  // ── 展示端调用（未登录用户）──

  /** 展示端：获取已发布相册列表 */
  listPublished: () =>
    request<GalleryPublicListItem[]>('/spaces/gallery/items?status=published'),

  /** 展示端：获取单个相册详情（含 photos） */
  getPublicDetail: (id: string) =>
    request<GalleryPublicDetail>(`/spaces/gallery/items/${id}`),

  // ── 管理端调用 ──

  /** 管理端：列出所有相册，可选按 status 过滤 */
  list: (status?: string) => {
    const query = status ? `?status=${status}` : '';
    return request<GalleryAdminListItem[]>(`/spaces/gallery/items${query}`);
  },

  /** 管理端：获取相册详情（含完整 photos + 状态元数据，需要 visibility=all） */
  getById: (id: string) =>
    request<GalleryAdminDetail>(`/spaces/gallery/items/${id}?visibility=all`),

  /** 编辑器加载：后端已合并草稿+正式版，前端直接消费 */
  getEditorState: (id: string) =>
    request<GalleryEditorState>(`/spaces/gallery/items/${id}/editor`),

  create: (dto: CreateGalleryPostDto) =>
    request<GalleryAdminListItem>('/spaces/gallery/items', {
      method: 'POST',
      // 后端 DTO 字段名为 bodyMarkdown，补充 changeNote 满足后端 @IsNotEmpty() 校验
      body: JSON.stringify({
        title: dto.title,
        bodyMarkdown: dto.description || '\u200B',
        changeNote: '创建画廊动态',
      }),
    }),

  /**
   * 正式提交：发结构化 JSON 给后端 PUT /spaces/gallery/items/:id，
   * 后端负责序列化为 frontmatter main.md，返回 GalleryAdminDetail。
   */
  update: (id: string, dto: UpdateGalleryPostDto) =>
    request<GalleryAdminDetail>(`/spaces/gallery/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  remove: (id: string) =>
    request<void>(`/spaces/gallery/items/${id}`, { method: 'DELETE' }),

  /**
   * 上传照片到 OSS 草稿存储，返回缩略图 URL + 原图 URL + EXIF。
   * url：OSS 就绪时为 400px 缩略图签名 URL，否则降级为代理 URL（网格直接使用）。
   * originalUrl：代理 URL，供编辑器大图预览。
   */
  uploadPhoto: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ url: string; originalUrl: string; fileName: string; size: number; exif: Record<string, string> }>(
      `/spaces/gallery/items/${id}/draft-assets`,
      { method: 'POST', body: formData },
    );
  },

  /** 发布。可选传 versionId 发布指定历史版本，不传则发布 latestVersion。 */
  publish: (id: string, versionId?: string) =>
    request<GalleryAdminDetail>(`/spaces/gallery/items/${id}/publish`, {
      method: 'PUT',
      body: versionId ? JSON.stringify({ versionId }) : undefined,
    }),

  unpublish: (id: string) =>
    request<GalleryAdminDetail>(`/spaces/gallery/items/${id}/unpublish`, {
      method: 'PUT',
    }),

  /**
   * 获取结构化草稿（后端已反序列化 frontmatter，前端直接拿 JSON 字段）。
   * 无草稿时后端返回 404，调用方需 catch 处理。
   */
  getDraft: (id: string) =>
    request<GalleryDraft>(`/spaces/gallery/items/${id}/draft`),

  /** 保存结构化草稿（前端发 JSON，后端序列化为 frontmatter 存储）。 */
  saveDraft: (id: string, dto: UpdateGalleryPostDto) =>
    request<GalleryDraft>(`/spaces/gallery/items/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** 删除草稿 */
  deleteDraft: (id: string) =>
    request<void>(`/spaces/gallery/items/${id}/draft`, { method: 'DELETE' }),

  /** 版本历史 */
  getHistory: (id: string) =>
    request<ContentHistoryEntry[]>(`/spaces/gallery/items/${id}/history`),

  /** 查看指定历史版本的结构化内容（后端已解析 frontmatter） */
  getByVersion: (id: string, versionId: string) =>
    request<GalleryVersionContent>(`/spaces/gallery/items/${id}/versions/${versionId}`),
};

// ── Anthology API ──

/** 展示端文集列表项 */
export interface AnthologyPublicListItem {
  id: string;
  title: string;
  description: string;
  entryCount: number;
  updatedAt: string;
}

/** 文集条目元数据（索引里的冗余字段） */
export interface AnthologyEntryMeta {
  key: string;
  title: string;
  date: string | null;
}

/** 展示端文集详情 */
export interface AnthologyPublicDetail {
  id: string;
  title: string;
  description: string;
  entries: AnthologyEntryMeta[];
}

/** 管理端文集列表项 */
export interface AnthologyAdminListItem extends AnthologyPublicListItem {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
}

/**
 * 管理端条目元数据（含两层发布状态字段）。
 * - publishedVersionId: 已发布的 snapshot versionId，null 表示条目未发布
 * - hasUnpublishedChanges: 条目有新内容尚未同步到 publishedVersionId
 */
export interface AnthologyAdminEntryMeta extends AnthologyEntryMeta {
  hasContent: boolean;
  publishedVersionId: string | null;
  hasUnpublishedChanges: boolean;
}

/** 管理端文集详情 */
export interface AnthologyAdminDetail extends AnthologyPublicDetail {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  entries: AnthologyAdminEntryMeta[];
}

/** 条目正文详情 */
export interface AnthologyEntryDetail {
  key: string;
  title: string;
  date: string | null;
  bodyMarkdown: string;
  prev: { key: string; title: string } | null;
  next: { key: string; title: string } | null;
}

/** 条目草稿保存请求体（复用 SaveDraftDto，summary 可选） */
export interface AnthologyEntryDraftDto extends EditorDraft {
  /** anthology 条目草稿无 summary，兼容 EditorDraft 类型 */
}

export const anthologyApi = {
  // ── 展示端 ──

  listPublished: () =>
    request<AnthologyPublicListItem[]>('/spaces/anthology/items?status=published'),

  getPublicDetail: (id: string) =>
    request<AnthologyPublicDetail>(`/spaces/anthology/items/${id}`),

  getEntry: (id: string, entryKey: string) =>
    request<AnthologyEntryDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}`),

  /** 获取条目的历史版本内容（按 snapshot versionId） */
  getEntryByVersion: (id: string, entryKey: string, versionId: string) =>
    request<AnthologyEntryDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}/versions/${versionId}`),

  // ── 管理端 ──

  list: (status?: string) => {
    const query = status ? `?status=${status}` : '';
    return request<AnthologyAdminListItem[]>(`/spaces/anthology/items${query}`);
  },

  getById: (id: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}?visibility=all`),

  create: (dto: { title: string }) =>
    request<AnthologyAdminListItem>('/spaces/anthology/items', {
      method: 'POST',
      body: JSON.stringify({ title: dto.title, bodyMarkdown: '\u200B', changeNote: '创建文集' }),
    }),

  addEntry: (id: string, dto: { title: string; date?: string; bodyMarkdown: string; changeNote?: string }) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  saveEntry: (id: string, entryKey: string, dto: { title: string; date?: string; bodyMarkdown: string; changeNote?: string }) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  removeEntry: (id: string, entryKey: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}`, {
      method: 'DELETE',
    }),

  reorderEntries: (id: string, newOrder: string[]) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ newOrder }),
    }),

  // ── 条目草稿 CRUD ──

  /** 获取条目草稿。无草稿返回 null（200）。 */
  getEntryDraft: (id: string, entryKey: string) =>
    request<EditorDraft | null>(`/spaces/anthology/items/${id}/entries/${entryKey}/draft`),

  /** 保存条目草稿（autosave）。只写 MongoDB，不产生 Git snapshot。 */
  saveEntryDraft: (id: string, entryKey: string, dto: SaveDraftDto) =>
    request<EditorDraft>(`/spaces/anthology/items/${id}/entries/${entryKey}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** 丢弃条目草稿。 */
  deleteEntryDraft: (id: string, entryKey: string) =>
    request<void>(`/spaces/anthology/items/${id}/entries/${entryKey}/draft`, {
      method: 'DELETE',
    }),

  /**
   * 获取单篇条目的版本历史（按 entries/eXXX.md 筛选），供管理端版本时间线使用。
   * 与 notes/gallery 的 getHistory 语义对等。
   */
  getEntryHistory: (id: string, entryKey: string) =>
    request<ContentHistoryEntry[]>(`/spaces/anthology/items/${id}/entries/${entryKey}/history`),

  // ── 文集级发布（上线/下线整个文集）──

  publish: (id: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/publish`, {
      method: 'PUT',
    }),

  unpublish: (id: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/unpublish`, {
      method: 'PUT',
    }),

  // ── 条目级发布（单篇独立发布/取消发布）──

  /** 发布单篇条目：将该条目 publishedVersionId 指向最新 snapshot。 */
  publishEntry: (id: string, entryKey: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}/publish`, {
      method: 'PUT',
    }),

  /** 取消发布单篇条目：将该条目 publishedVersionId 设为 null。 */
  unpublishEntry: (id: string, entryKey: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/${entryKey}/unpublish`, {
      method: 'PUT',
    }),

  /** 批量发布所有有内容的条目（一次提交，高效）。 */
  publishAllEntries: (id: string) =>
    request<AnthologyAdminDetail>(`/spaces/anthology/items/${id}/entries/publish-all`, {
      method: 'POST',
    }),

  remove: (id: string) =>
    request<void>(`/spaces/anthology/items/${id}`, { method: 'DELETE' }),
};

// ── 首页 ──

/** 首页笔记条目（含字数） */
export interface HomeNoteItem extends ContentListItem {
  wordCount: number;
}

/** GET /home 返回结构 */
export interface HomeData {
  notes: HomeNoteItem[];
  gallery: GalleryPublicListItem[];
}

export const homeApi = {
  get: () => request<HomeData>('/home'),
};

