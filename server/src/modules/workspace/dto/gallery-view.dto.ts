/**
 * Gallery scope 的专用 DTO。
 * 画廊的列表视图需要额外的封面图、照片计数等字段，
 * 详情视图需要完整的照片列表。
 */
export class GalleryPhotoDto {
  id: string;
  url: string;
  fileName: string;
  size: number;
  order: number;
  /** MongoDB 侧保存的照片描述，默认空串。 */
  caption: string;
}

export class GalleryPostDto {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published';
  coverUrl: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  /** 自定义标签，key-value 格式。 */
  tags: Record<string, string>;
  /** 手动指定的封面图文件名，null 表示退化为首图。 */
  coverPhotoFileName: string | null;
  /** 前 9 张图片的访问 URL，用于列表页缩略图预览。 */
  previewPhotoUrls: string[];
  /** 已发布版本的 commitHash，null 表示未发布。 */
  publishedCommitHash: string | null;
  /** 是否有未发布的变更（latestVersion !== publishedVersion）。 */
  hasUnpublishedChanges: boolean;
}

export class GalleryPostDetailDto extends GalleryPostDto {
  photos: GalleryPhotoDto[];
}
