import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ContentChangeLog, ContentChangeType } from '../content-item.entity';

export class ChangeLogDto {
  @IsString()
  @IsOptional()
  commitHash?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsDateString()
  @IsOptional()
  createdAt?: string;

  @IsEnum(ContentChangeType)
  changeType!: ContentChangeType;

  @IsString()
  @IsNotEmpty()
  changeNote!: string;

  static fromEntity(entity: ContentChangeLog): ChangeLogDto {
    return {
      commitHash: entity.commitHash,
      title: entity.title,
      summary: entity.summary,
      createdAt: entity.createdAt.toISOString(),
      changeType: entity.changeType,
      changeNote: entity.changeNote,
    };
  }
}
