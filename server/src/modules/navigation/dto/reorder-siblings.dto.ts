import { IsArray, IsOptional, IsString } from 'class-validator';

export class ReorderSiblingsDto {
  @IsString()
  @IsOptional()
  parentId?: string | null;

  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];
}
