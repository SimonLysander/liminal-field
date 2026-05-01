import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateWorkspaceItemDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  bodyMarkdown?: string;

  @IsString()
  @IsOptional()
  changeNote?: string;
}
