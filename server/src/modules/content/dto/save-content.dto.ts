import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
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
  @IsOptional()
  summary?: string;

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

  /** 来源标识（'user'|'system'|'ai'|'import'），不传时 snapshot 无 source 字段 */
  @IsString()
  @IsOptional()
  source?: string;

  /**
   * 文件路径标识。null/不传 = main.md，非 null = 子文件（如 "entries/e001.md"）。
   * fileName 非 null 时，提交不更新 ContentItem.latestVersion（只跟踪 main.md）。
   */
  @IsString()
  @IsOptional()
  fileName?: string | null;

  /**
   * publish 时指定发布哪个历史 commitHash。
   * 不传则默认发布 latestVersion（当前行为）。
   * 用于"发布此版本"场景——直接把 publishedVersion 指向某个历史版本。
   */
  // 安全：限制 commit hash 格式，防止任意字符串注入 git 命令
  @Matches(/^[0-9a-f]{7,64}$/i)
  @IsString()
  @IsOptional()
  publishCommitHash?: string;
}
