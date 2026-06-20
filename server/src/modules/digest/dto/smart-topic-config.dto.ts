/**
 * SmartTopicConfig DTOs。
 *
 * 创建事项时是「容器 + 配置」一起建（在 controller 层用 CreateTopicDto 串起来），
 * 这里只是「配置」本身的 DTO，用于编辑现有事项的配置项。
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
import { RunStatus } from '../smart-topic-config.entity';

/** 校验 cron 格式 — 简单正则放过五段式（不深校验日期合法性，留给 @nestjs/schedule 运行时报错）。 */
const CRON_PATTERN = /^(\S+\s+){4}\S+$/;

export class CreateTopicDto {
  /** 事项名 — 同步用作 NavigationNode.name + ContentItem.title。 */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  cron!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(50)
  sourceIds!: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  keywords!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  prompt!: string;

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

export class UpdateTopicConfigDto {
  @IsString()
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
}

export interface SmartTopicConfigDto {
  id: string;
  contentItemId: string;
  cron: string;
  sourceIds: string[];
  keywords: string[];
  prompt: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** 简易 cron 格式预校验（service 层使用） — 5 段空白分隔的非空 token。 */
export function isValidCronFormat(value: string): boolean {
  return CRON_PATTERN.test(value.trim());
}
