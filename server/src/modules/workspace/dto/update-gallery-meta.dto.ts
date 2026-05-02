/**
 * 更新画廊帖子元数据的请求 DTO。
 * 支持局部更新：三个字段均为可选，未传字段不被覆盖。
 */
import { IsArray, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** 单张照片的元数据更新项。 */
export class PhotoMetaItemDto {
  @IsString()
  fileName!: string;

  @IsString()
  caption!: string;

  @IsNumber()
  order!: number;
}

export class UpdateGalleryMetaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhotoMetaItemDto)
  @IsOptional()
  photos?: PhotoMetaItemDto[];

  @IsString()
  @IsOptional()
  coverPhotoFileName?: string | null;

  @IsObject()
  @IsOptional()
  tags?: Record<string, string>;
}
