import { ChangeLogDto } from './change-log.dto';
import { ContentStatus } from '../content-item.entity';

export type ContentAssetType = 'image' | 'audio' | 'video' | 'file';

export class ContentVersionDto {
  commitHash!: string;
  title!: string;
  summary!: string;
}

export class ContentAssetRefDto {
  path!: string;
  type!: ContentAssetType;
}

export class ContentDetailDto {
  id!: string;
  title!: string;
  summary!: string;
  status!: ContentStatus;
  latestVersion!: ContentVersionDto;
  publishedVersion?: ContentVersionDto | null;
  latestCommitHash?: string;
  publishedCommitHash?: string;
  hasUnpublishedChanges!: boolean;
  bodyMarkdown!: string;
  plainText!: string;
  assetRefs!: ContentAssetRefDto[];
  changeLogs!: ChangeLogDto[];
  createdAt!: string;
  updatedAt!: string;
}
