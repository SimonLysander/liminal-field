import { IsString, IsOptional, IsNotEmpty, Matches } from 'class-validator';

/** POST /import/confirm 的请求体 */
export class ConfirmImportDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{16}$/, { message: 'parseId 格式不合法' })
  parseId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  title?: string;
}
