import { IsString, IsNotEmpty } from 'class-validator';

/** 批量操作（publish / unpublish）请求体：指定目标文件夹 ID。 */
export class BatchOperationDto {
  @IsString()
  @IsNotEmpty()
  folderId!: string;
}
