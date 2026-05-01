import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SaveDraftDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  summary!: string;

  @IsString()
  @IsNotEmpty()
  bodyMarkdown!: string;

  @IsString()
  @IsNotEmpty()
  changeNote!: string;

  @IsString()
  @IsOptional()
  savedBy?: string;
}
