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

import { request } from './request';

// ─── 共用类型（原 content-items.ts 导出，保持不变供消费方使用）───

export type ContentStatus = 'committed' | 'published' | 'archived';
export type ContentChangeType = 'patch' | 'major';
export type ContentAssetType = 'image' | 'audio' | 'video' | 'file';
export type ContentVisibility = 'public' | 'all';
export type ContentSaveAction = 'commit' | 'publish' | 'unpublish';

export interface ContentVersion {
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

export interface ContentAssetRef {
  path: string;
  type: ContentAssetType;
}

export interface ContentListItem {
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  latestCommitHash?: string;
  publishedCommitHash?: string;
  hasUnpublishedChanges: boolean;
  latestChange?: ChangeLog;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDetail {
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  latestVersion: ContentVersion;
  publishedVersion?: ContentVersion | null;
  latestCommitHash?: string;
  publishedCommitHash?: string;
  hasUnpublishedChanges: boolean;
  bodyMarkdown: string;
  plainText: string;
  assetRefs: ContentAssetRef[];
  changeLogs: ChangeLog[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentDto {
  title: string;
  summary?: string;
  status: ContentStatus;
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
  path: string;
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
  commitHash: string;
  committedAt: string;
  authorName: string;
  authorEmail: string;
  message: string;
  action: 'commit' | 'unknown';
}

// ─── Gallery 类型（原 gallery.ts 导出，保持不变）───

export interface GalleryPost {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  coverUrl: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  /** key-value 标签，如 { location: '上海', season: '春' } */
  tags: Record<string, string>;
  /** 封面照片的原始文件名，null 表示未设置 */
  coverPhotoFileName: string | null;
  /** 预览图 URL 列表（前 N 张缩略图，由后端返回） */
  previewPhotoUrls: string[];
  /** 已发布版本的 commitHash，null 表示未发布 */
  publishedCommitHash: string | null;
  /** latestVersion 与 publishedVersion 不一致时为 true */
  hasUnpublishedChanges: boolean;
}

export interface GalleryPhoto {
  id: string;
  url: string;
  fileName: string;
  size: number;
  order: number;
  /** 照片说明文字，空字符串表示无说明 */
  caption: string;
  /** 照片级 key-value 标签，如 { location: '上海' } */
  tags: Record<string, string>;
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
  changeNote?: string;
}

// ─── 工具函数 ───

function toQueryString(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

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
    request<EditorDraft>(`/spaces/notes/items/${id}/draft`),

  saveDraft: (id: string, dto: SaveDraftDto) =>
    request<EditorDraft>(`/spaces/notes/items/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  deleteDraft: (id: string) =>
    request<void>(`/spaces/notes/items/${id}/draft`, { method: 'DELETE' }),

  publish: (id: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/publish`, { method: 'PUT' }),

  unpublish: (id: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/unpublish`, { method: 'PUT' }),

  getByVersion: (id: string, commitHash: string) =>
    request<ContentDetail>(`/spaces/notes/items/${id}/versions/${commitHash}`),

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

// ─── galleryApi — gallery scope 专用，兼容原 galleryApi 接口 ───

export const galleryApi = {
  list: (status?: 'draft' | 'published') => {
    const query = status ? `?status=${status}` : '';
    return request<GalleryPost[]>(`/spaces/gallery/items${query}`);
  },

  getById: (id: string) =>
    request<GalleryPostDetail>(`/spaces/gallery/items/${id}`),

  create: (dto: CreateGalleryPostDto) =>
    request<GalleryPost>('/spaces/gallery/items', {
      method: 'POST',
      // 后端 DTO 字段名为 bodyMarkdown，补充 changeNote 满足后端 @IsNotEmpty() 校验
      body: JSON.stringify({
        title: dto.title,
        bodyMarkdown: dto.description || '\u200B',
        changeNote: '创建画廊动态',
      }),
    }),

  update: (id: string, dto: UpdateGalleryPostDto) =>
    request<GalleryPost>(`/spaces/gallery/items/${id}`, {
      method: 'PUT',
      // 后端 DTO 字段名为 bodyMarkdown，补充 changeNote 满足后端 @IsNotEmpty() 校验
      body: JSON.stringify({
        title: dto.title,
        bodyMarkdown: dto.description !== undefined
          ? (dto.description || '\u200B')
          : undefined,
        changeNote: dto.changeNote ?? '更新画廊动态',
      }),
    }),

  remove: (id: string) =>
    request<void>(`/spaces/gallery/items/${id}`, { method: 'DELETE' }),

  /** 上传照片：对应后端 POST /spaces/gallery/items/:id/assets */
  uploadPhoto: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<GalleryPhoto>(`/spaces/gallery/items/${id}/assets`, {
      method: 'POST',
      body: formData,
    });
  },

  /** 删除照片：对应后端 DELETE /spaces/gallery/items/:id/assets/:photoId */
  deletePhoto: (id: string, photoId: string) =>
    request<void>(`/spaces/gallery/items/${id}/assets/${photoId}`, {
      method: 'DELETE',
    }),

  publish: (id: string) =>
    request<GalleryPost>(`/spaces/gallery/items/${id}/publish`, {
      method: 'PUT',
    }),

  unpublish: (id: string) =>
    request<GalleryPost>(`/spaces/gallery/items/${id}/unpublish`, {
      method: 'PUT',
    }),

  /** 获取草稿，复用 notesApi 相同的 EditorDraft 结构 */
  getDraft: (id: string) =>
    request<EditorDraft>(`/spaces/gallery/items/${id}/draft`),

  /** 保存草稿，复用 notesApi 相同的 SaveDraftDto 结构 */
  saveDraft: (id: string, dto: SaveDraftDto) =>
    request<EditorDraft>(`/spaces/gallery/items/${id}/draft`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** 删除草稿 */
  deleteDraft: (id: string) =>
    request<void>(`/spaces/gallery/items/${id}/draft`, { method: 'DELETE' }),

  /** 版本历史 */
  getHistory: (id: string) =>
    request<ContentHistoryEntry[]>(`/spaces/gallery/items/${id}/history`),

  /** 查看指定历史版本的内容 */
  getByVersion: (id: string, commitHash: string) =>
    request<ContentDetail>(`/spaces/gallery/items/${id}/versions/${commitHash}`),
};

