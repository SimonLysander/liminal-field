import { IsString, IsOptional } from 'class-validator';

/** POST /import/confirm 的请求体 */
export class ConfirmImportDto {
  @IsString()
  parseId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  title?: string;
}
