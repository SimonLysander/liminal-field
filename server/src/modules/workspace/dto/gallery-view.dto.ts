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
}

export class GalleryPostDetailDto extends GalleryPostDto {
  photos: GalleryPhotoDto[];
}
