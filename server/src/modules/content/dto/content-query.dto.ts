import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContentStatus } from '../content-item.entity';

export enum ContentVisibility {
  public = 'public',
  all = 'all',
}

export class ContentQueryDto {
  @IsEnum(ContentStatus)
  @IsOptional()
  status?: ContentStatus;

  @IsEnum(ContentVisibility)
  @IsOptional()
  visibility?: ContentVisibility;

  @IsString()
  @IsOptional()
  q?: string;

  /** 按 scope 过滤搜索结果（notes / gallery / anthology） */
  @IsIn(['notes', 'gallery', 'anthology'])
  @IsOptional()
  scope?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;
}
