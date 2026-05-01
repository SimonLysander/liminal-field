import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { NavigationScope } from '../navigation.entity';

export class CreateStructureNodeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(NavigationScope)
  @IsOptional()
  scope?: NavigationScope;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsIn(['FOLDER', 'DOC'])
  type: 'FOLDER' | 'DOC';

  @IsString()
  @IsOptional()
  contentItemId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
