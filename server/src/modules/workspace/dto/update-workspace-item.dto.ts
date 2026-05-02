import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateWorkspaceItemDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  bodyMarkdown?: string;

  @IsString()
  @IsNotEmpty()
  changeNote!: string;

  /** 业务动作：commit（默认）= 只提交，publish = 提交并发布 */
  @IsString()
  @IsIn(['commit', 'publish'])
  @IsOptional()
  action?: 'commit' | 'publish';
}
