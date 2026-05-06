import { ChangeLogDto } from './change-log.dto';
import { ContentStatus } from '../content-item.entity';
import { HeadingDto } from '../../../common/extract-headings';

/** 正文引用的附件在 API/存储层的类型归类，与客户端展示/图标一致 */
export type ContentAssetType = 'image' | 'audio' | 'video' | 'file';

export class ContentVersionDto {
  commitHash!: string;
  title!: string;
  summary!: string;
}

export class ContentDetailDto {
  id!: string;
  title!: string;
  summary!: string;
  status!: ContentStatus;
  latestVersion!: ContentVersionDto;
  publishedVersion?: ContentVersionDto | null;
  hasUnpublishedChanges!: boolean;
  bodyMarkdown!: string;
  /** 后端提取的标题树，前端直接消费渲染 TOC，不再自行解析 markdown */
  headings!: HeadingDto[];
  changeLogs!: ChangeLogDto[];
  createdAt!: string;
  updatedAt!: string;
}
