/**
 * UpdateSkillDto — 更新 Skill 的请求体(全字段可选)。
 *
 * 不依赖 @nestjs/mapped-types(项目未引入,避免新增依赖),手写一份与 CreateSkillDto
 * 同步的可选版。一旦字段语义需要新加/改长度,两边同时改。
 */
import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,40}$/, {
    message:
      'name 必须匹配 /^[a-z][a-z0-9_-]{1,40}$/(小写起头,允许 - _ 数字,2-41 字符)',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  whenToUse?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredTools?: string[];
}
