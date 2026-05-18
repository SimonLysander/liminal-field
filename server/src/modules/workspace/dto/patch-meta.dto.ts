import { IsOptional, IsString } from 'class-validator';

/** 轻量元数据更新，不创建新版本。 */
export class PatchMetaDto {
  @IsString()
  @IsOptional()
  summary?: string;
}
