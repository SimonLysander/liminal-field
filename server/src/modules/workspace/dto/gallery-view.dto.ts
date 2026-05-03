/**
 * Gallery scope 的专用 DTO。
 * 画廊的列表视图需要额外的封面图、照片计数等字段，
 * 详情视图需要完整的照片列表。
 * 元数据来源从 MongoDB 迁移至 main.md YAML frontmatter。
 */
export class GalleryPhotoDto {
  /** 照片唯一标识，等同于 fileName。 */
  id: string;
  url: string;
  fileName: string;
  size: number;
  order: number;
  /** frontmatter 中保存的照片描述，默认空串。 */
  caption: string;
  /** photo 级自定义标签，key-value 格式（如 camera: GR III）。 */
  tags: Record<string, string>;
}

export class GalleryPostDto {
  id: string;
  title: string;
  /** main.md frontmatter 后的随笔正文（prose 部分）。 */
  description: string;
  status: 'draft' | 'published';
  coverUrl: string | null;
  photoCount: number;
  /** 帖子级自定义标签，key-value 格式（如 location: 北京）。 */
  tags: Record<string, string>;
  /** frontmatter.cover 指定的封面图文件名，null 表示退化为首图。 */
  coverPhotoFileName: string | null;
  /** 前 9 张图片的访问 URL，用于列表页缩略图预览。 */
  previewPhotoUrls: string[];
  /** 已发布版本的 commitHash，null 表示未发布。 */
  publishedCommitHash: string | null;
  /** 是否有未发布的变更（latestVersion !== publishedVersion）。 */
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
}

export class GalleryPostDetailDto extends GalleryPostDto {
  photos: GalleryPhotoDto[];
}

/** 画廊草稿的结构化响应（前端不接触 bodyMarkdown/frontmatter，直接拿到解析后的字段）。 */
export class GalleryDraftDto {
  title!: string;
  prose!: string;
  photos!: Array<{ file: string; caption: string; tags: Record<string, string> }>;
  cover!: string | null;
  tags!: Record<string, string>;
  savedAt!: string;
}
