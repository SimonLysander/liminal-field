/**
 * InfoSource DTOs — 创建 / 更新 / 响应。
 *
 * config 字段按 type 解释（首期 type=rss → config={url}），骨架阶段只校验"是个 object"，
 * 严格的 type discriminator 子校验留给 service 层（首期 rss 校验 url 必须非空 https）。
 */
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { InfoSourceType, FetchStatus } from '../info-source.entity';

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
}

/** API 响应 DTO — 不直接吐 mongoose document，便于未来字段演化时不破坏 wire format。 */
export interface InfoSourceDto {
  id: string;
  type: InfoSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastFetchStatus: FetchStatus | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string | null;
}
