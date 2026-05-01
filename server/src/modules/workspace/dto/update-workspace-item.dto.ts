import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  changeNote: string;
}
