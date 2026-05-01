import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { NavigationNodeType, NavigationScope } from '../navigation.entity';

export class CreateNavigationNodeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(NavigationScope)
  @IsOptional()
  scope?: NavigationScope;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsEnum(NavigationNodeType)
  @IsNotEmpty()
  nodeType: NavigationNodeType;

  @IsString()
  @IsOptional()
  contentItemId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
