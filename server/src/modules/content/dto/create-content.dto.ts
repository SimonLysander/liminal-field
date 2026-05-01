import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContentChangeType, ContentStatus } from '../content-item.entity';

export class CreateContentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsEnum(ContentStatus)
  status!: ContentStatus;

  @IsString()
  @IsNotEmpty()
  bodyMarkdown!: string;

  @IsString()
  @IsOptional()
  changeNote?: string;

  @IsEnum(ContentChangeType)
  @IsOptional()
  changeType?: ContentChangeType;

  @IsString()
  @IsOptional()
  createdBy?: string;
}
