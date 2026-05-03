import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
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

/** 画廊专属的保存 DTO（提交和草稿共用）。前端只发 JSON，不知道 frontmatter 的存在。 */
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

  @IsObject()
  @IsOptional()
  tags?: Record<string, string>;

  @IsString()
  @IsOptional()
  changeNote?: string;
}
