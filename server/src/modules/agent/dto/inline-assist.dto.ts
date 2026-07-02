import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class InlineAssistDto {
  @IsIn(['continue'])
  @IsOptional()
  mode?: 'continue';

  @IsString()
  @MaxLength(40_000)
  @IsOptional()
  beforeText?: string;

  @IsString()
  @MaxLength(20_000)
  @IsOptional()
  selectedText?: string;

  @IsString()
  @MaxLength(20_000)
  @IsOptional()
  afterText?: string;

  @IsString()
  @MaxLength(2_000)
  @IsOptional()
  instruction?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  documentTitle?: string;

  @IsString()
  @MaxLength(80)
  @IsOptional()
  scope?: string;
}
