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

  // 统一页面树:节点不再有静态类型,type 由后端按「是否有子节点」动态计算。
  // 这里保留为可选,仅向后兼容仍传 type 的旧调用方(后端会忽略其值)。
  @IsIn(['FOLDER', 'DOC'])
  @IsOptional()
  type?: 'FOLDER' | 'DOC';

  @IsString()
  @IsOptional()
  contentItemId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
