import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { NavigationScope } from '../navigation.entity';

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

  // 节点同质化:每个节点都挂一个 ContentItem,故必填
  @IsString()
  @IsNotEmpty()
  contentItemId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
