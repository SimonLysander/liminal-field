import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GalleryPhotoEntryDto {
  @IsString()
  file!: string;

  @IsString()
  caption!: string;

  @IsObject()
  @IsOptional()
  tags?: Record<string, string>;
}

/**
 * 画廊专属的保存 DTO（提交和草稿共用）。前端只发 JSON，不知道 frontmatter 的存在。
 * frontmatter 协议变更：帖子级 tags 拆为独立的 date + location 一级字段。
 */
export class SaveGalleryPostDto {
  @IsString()
  title!: string;

  @IsString()
  prose!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryPhotoEntryDto)
  @IsOptional()
  photos?: GalleryPhotoEntryDto[];

  @IsString()
  @IsOptional()
  cover?: string | null;

  /** 帖子拍摄/发生日期（ISO 8601 日期字符串，如 "2024-03-15"），可选。 */
  @IsString()
  @IsOptional()
  date?: string | null;

  /** 帖子地点，自由文本，可选。 */
  @IsString()
  @IsOptional()
  location?: string | null;

  @IsString()
  @IsOptional()
  changeNote?: string;
}
