import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 轻量元数据更新，不创建新版本。 */
export class PatchMetaDto {
  /**
   * 摘要 / 文集简介。300 字硬上限,跟前端 textarea maxLength=300 对齐;
   * 没有它后端会被绕过软约束,塞超长字符串到 ContentItem.latestVersion.summary
   * 并触发文集容器重提快照。
   */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  summary?: string;
}
