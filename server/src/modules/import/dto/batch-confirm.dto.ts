import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsOptional,
} from 'class-validator';

/** 批量确认导入请求体：指定批次 ID、目标父节点（可选，空=根目录）、以及用户选中的文件路径列表。 */
export class BatchConfirmDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  // parentId 可选：缺失或空串 → 顶层节点建在 notes scope 根下
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  selectedPaths!: string[];
}
