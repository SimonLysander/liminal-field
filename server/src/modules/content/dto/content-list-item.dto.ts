import { ChangeLogDto } from './change-log.dto';
import { ContentStatus } from '../content-item.entity';
import { ContentVersionDto } from './content-detail.dto';

export class ContentListItemDto {
  id!: string;
  title!: string;
  summary!: string;
  status!: ContentStatus;
  latestVersion!: ContentVersionDto;
  publishedVersion?: ContentVersionDto | null;
  hasUnpublishedChanges!: boolean;
  latestChange?: ChangeLogDto;
  createdAt!: string;
  updatedAt!: string;
}
