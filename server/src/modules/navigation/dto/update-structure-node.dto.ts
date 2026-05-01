import { IsInt, IsIn, IsOptional, IsString, Min } from 'class-validator';

export class UpdateStructureNodeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsIn(['FOLDER', 'DOC'])
  @IsOptional()
  type?: 'FOLDER' | 'DOC';

  @IsString()
  @IsOptional()
  contentItemId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
