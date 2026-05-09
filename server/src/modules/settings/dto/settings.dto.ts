import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

/** KB 远程仓库配置请求体（用于 validate 和 save 两个接口）。 */
export class KbRemoteDto {
  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsOptional()
  token?: string;
}

/** 灾难恢复执行请求体：指定要恢复的 contentId 列表（不传则自动取扫描结果中 missingInDb）。 */
export class ExecuteRecoveryDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  contentIds?: string[];
}
