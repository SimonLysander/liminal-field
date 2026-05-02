import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** update 永远是业务提交（commit），发布走独立的 publish 端点。 */
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
}
