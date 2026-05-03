import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * CreateContentDto — 创建 content item 的最小输入。
 *
 * createContent() 只建 MongoDB 记录（commitHash 为空），不写 Git。
 * bodyMarkdown、status 等字段在首次 saveContent/commit 时才需要。
 */
export class CreateContentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  createdBy?: string;
}
