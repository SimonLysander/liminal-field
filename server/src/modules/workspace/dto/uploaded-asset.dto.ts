export class UploadedAssetDto {
  path!: string;
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
