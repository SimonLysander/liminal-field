import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';

/** 批量确认导入请求体：指定批次 ID、目标父节点、以及用户选中的文件路径列表。 */
export class BatchConfirmDto {
  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsString()
  @IsNotEmpty()
  parentId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  selectedPaths!: string[];
}
