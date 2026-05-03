import { ArrayMinSize, ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class ReorderSiblingsDto {
  @IsString()
  @IsOptional()
  parentId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  nodeIds: string[];
}
