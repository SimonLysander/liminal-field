/**
 * 画廊场景上下文 —— 来自 entryContext.gallery,单次 chat 请求内 immutable。
 * 照片清单(文字)+ 随笔;图像字节不在此,由 agent.service 的 prepareStep 按 fileName 按需注入。
 */
export interface GalleryPhotoEntry {
  index: number;
  fileName: string;
  caption: string;
  tags: Record<string, string>;
}

export interface GalleryContext {
  contentItemId: string;
  title: string;
  prose: string;
  photos: GalleryPhotoEntry[];
}
