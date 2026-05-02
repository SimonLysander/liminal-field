import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContentChangeType, ContentStatus } from '../content-item.entity';

export enum ContentSaveAction {
  commit = 'commit',
  publish = 'publish',
  unpublish = 'unpublish',
}

export class SaveContentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsEnum(ContentStatus)
  status!: ContentStatus;

  @IsString()
  @IsNotEmpty()
  bodyMarkdown!: string;

  @IsString()
  @IsNotEmpty()
  changeNote!: string;

  @IsEnum(ContentChangeType)
  @IsOptional()
  changeType?: ContentChangeType;

  @IsEnum(ContentSaveAction)
  @IsOptional()
  action?: ContentSaveAction;

  @IsString()
  @IsOptional()
  updatedBy?: string;

  /**
   * publish 时指定发布哪个历史 commitHash。
   * 不传则默认发布 latestVersion（当前行为）。
   * 用于"发布此版本"场景——直接把 publishedVersion 指向某个历史版本。
   */
  @IsString()
  @IsOptional()
  publishCommitHash?: string;
}
