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
}
