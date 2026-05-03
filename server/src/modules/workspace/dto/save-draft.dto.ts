import { IsOptional, IsString } from 'class-validator';

/**
 * SaveDraftDto — 草稿保存。
 *
 * 草稿是未完成的中间态，所有内容字段允许空字符串。
 * 严格校验（@IsNotEmpty）只在正式提交（SaveContentDto）时执行。
 */
export class SaveDraftDto {
  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsString()
  bodyMarkdown!: string;

  @IsString()
  changeNote!: string;

  @IsString()
  @IsOptional()
  savedBy?: string;
}
