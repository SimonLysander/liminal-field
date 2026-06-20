/**
 * UpdateTopicDto — 事项 PATCH 更新输入。
 *
 * 所有字段均为可选：name / description / cron / sourceIds / keywords / prompt / enabled。
 * 若 name 改变，service 层会同步 NavigationNode.name + ContentItem.title。
 */
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateTopicDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  cron?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsOptional()
  sourceIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  keywords?: string[];

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  prompt?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** Agent 最大轮次，范围 5-50，默认 20（schema default 兜底） */
  @IsInt()
  @Min(5)
  @Max(50)
  @IsOptional()
  maxSteps?: number;
}
