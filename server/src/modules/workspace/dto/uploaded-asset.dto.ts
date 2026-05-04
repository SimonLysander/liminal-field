export class UploadedAssetDto {
  /** 前端可直接访问的资源 URL（API 路径）。 */
  url!: string;
  fileName!: string;
  contentType!: string;
  size!: number;
}

export class ListedAssetDto {
  path!: string;
  fileName!: string;
  type!: 'image' | 'audio' | 'video' | 'file';
  size!: number;
}
