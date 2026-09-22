import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module';
import { NavigationNodeController } from '../navigation/navigation.controller';
import { NavigationModule } from '../navigation/navigation.module';
import { StructureMutationService } from './structure-mutation.service';

/** 组合导航能力与依赖导航树的业务规则，对外提供结构写入接口。 */
@Module({
  imports: [NavigationModule, LearningModule],
  controllers: [NavigationNodeController],
  providers: [StructureMutationService],
})
export class StructureModule {}
