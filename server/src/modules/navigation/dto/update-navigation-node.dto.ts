import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateNavigationNodeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsString()
  @IsOptional()
  contentItemId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
