/**
 * Gallery scope 的专用 DTO，按消费场景拆分。
 * 展示端（visibility=public）和管理端（visibility=all）各自使用独立 DTO，
 * 避免单一 DTO 混入不同场景的字段。
 *
 * frontmatter 协议变更：帖子级标签从 tags: { location } 拆为独立一级字段 date + location。
 */

// ── 共用 ──

/** 单张照片，展示端和管理端详情共享。 */
export class GalleryPhotoDto {
  /** 照片唯一标识，等同于 fileName。 */
  id: string;
  url: string;
  fileName: string;
  /** 文件大小（字节） */
  size: number;
  caption: string;
  /** photo 级自定义标签，key-value 格式（如 camera: GR III）。 */
  tags: Record<string, string>;
}

// ── 展示端列表 ──

export class GalleryPublicListItemDto {
  id: string;
  title: string;
  /** 帖子拍摄/发生日期（ISO 8601 日期字符串），null 表示未设置。 */
  date: string | null;
  /** 帖子地点，null 表示未设置。 */
  location: string | null;
  createdAt: string;
}

// ── 展示端详情 ──

export class GalleryPublicDetailDto {
  id: string;
  title: string;
  /** frontmatter 后的随笔正文。 */
  prose: string;
  photos: GalleryPhotoDto[];
  date: string | null;
  location: string | null;
  createdAt: string;
}

// ── 管理端列表 ──

export class GalleryAdminListItemDto {
  id: string;
  title: string;
  status: string;
  coverUrl: string | null;
  photoCount: number;
  /** 是否有已提交但未发布的变更。 */
  hasUnpublishedChanges: boolean;
  date: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── 管理端详情 ──

export class GalleryAdminDetailDto {
  id: string;
  title: string;
  prose: string;
  status: string;
  photos: GalleryPhotoDto[];
  /** frontmatter.cover 指定的封面图文件名，null 表示退化为首图。 */
  coverPhotoFileName: string | null;
  hasUnpublishedChanges: boolean;
  /** 已发布版本的 commitHash，null 表示未发布。 */
  publishedCommitHash: string | null;
  date: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── 编辑器加载 ──

/** 编辑器中单张照片，包含尺寸信息和后端拼好的 URL（MinIO 或 Git）。 */
export class GalleryEditorPhotoDto {
  file: string;
  /** 后端已按照片来源（草稿 MinIO / 已提交 Git）拼好的访问 URL。 */
  url: string;
  size: number;
  caption: string;
  tags: Record<string, string>;
}

/** 编辑器加载 DTO：后端已合并草稿和正式版的照片列表，前端无需感知存储细节。 */
export class GalleryEditorDto {
  id: string;
  title: string;
  prose: string;
  photos: GalleryEditorPhotoDto[];
  cover: string | null;
  date: string | null;
  location: string | null;
  /** 是否存在未提交的草稿。 */
  hasDraft: boolean;
  /** 草稿最后保存时间（ISO 8601），无草稿时为 null。 */
  draftSavedAt: string | null;
}

// ── 版本查看 ──

export class GalleryVersionDto {
  commitHash: string;
  title: string;
  prose: string;
  photos: { file: string; caption: string; tags: Record<string, string> }[];
  cover: string | null;
  date: string | null;
  location: string | null;
}

// ── 草稿（内部序列化使用，前端直接消费解析后的结构化字段）──

/** 画廊草稿的结构化响应（前端不接触 bodyMarkdown/frontmatter，直接拿到解析后的字段）。 */
export class GalleryDraftDto {
  title!: string;
  prose!: string;
  photos!: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  cover!: string | null;
  date!: string | null;
  location!: string | null;
  savedAt!: string;
}
