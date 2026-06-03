/**
 * CreateSkillDto — 新建 Skill 的请求体。
 *
 * 字段长度上限对齐 Skill entity 的 @prop maxlength,
 * name 走 slug 正则保证可作 slash 命令(/critic)。
 */
import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSkillDto {
  /** slug:小写字母起头,允许 - _ 数字,2-41 字符,用于 slash 命令 */
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,40}$/, {
    message:
      'name 必须匹配 /^[a-z][a-z0-9_-]{1,40}$/(小写起头,允许 - _ 数字,2-41 字符)',
  })
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  description!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  whenToUse!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  /** 可选;省略时默认 [] */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredTools?: string[];
}
