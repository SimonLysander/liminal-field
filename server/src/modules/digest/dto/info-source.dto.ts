/**
 * InfoSource DTOs — 创建 / 更新 / 响应 / 查询过滤。
 *
 * config 字段按 type 解释（首期 type=rss → config={url}），骨架阶段只校验"是个 object"，
 * 严格的 type discriminator 子校验留给 service 层（首期 rss 校验 url 必须非空 https）。
 *
 * category（Task #42）：创建时必填（InfoSourceCategory enum），更新时可选。
 * description（Task #42）：创建/更新可选，最长 200 字，给 agent system prompt 消费。
 */
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  InfoSourceType,
  FetchStatus,
  InfoSourceCategory,
} from '../info-source.entity';

export class CreateInfoSourceDto {
  @IsEnum(InfoSourceType)
  type!: InfoSourceType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsObject()
  config!: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** 信息源分类，必填；不填时 class-validator 直接 400。 */
  @IsEnum(InfoSourceCategory)
  category!: InfoSourceCategory;

  /** 一句话简介（可选），最长 200 字。 */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;
}

export class UpdateInfoSourceDto {
  @IsEnum(InfoSourceType)
  @IsOptional()
  type?: InfoSourceType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** 更新分类（可选）。 */
  @IsEnum(InfoSourceCategory)
  @IsOptional()
  category?: InfoSourceCategory;

  /** 更新简介（可选）。 */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;
}

/**
 * GET /info-sources 查询参数 DTO。
 * category 传无效值时 class-validator → 400 BadRequest（@IsEnum 保证）。
 */
export class ListInfoSourcesQueryDto {
  /** 按分类过滤（可选），传无效 enum 值返回 400。 */
  @IsEnum(InfoSourceCategory)
  @IsOptional()
  category?: InfoSourceCategory;
}

/** API 响应 DTO — 不直接吐 mongoose document，便于未来字段演化时不破坏 wire format。 */
export interface InfoSourceDto {
  id: string;
  type: InfoSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  /** 信息源分类。 */
  category: InfoSourceCategory;
  /** 一句话简介；老数据无此字段时返 null。 */
  description: string | null;
  lastFetchedAt: string | null;
  lastFetchStatus: FetchStatus | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string | null;
}
