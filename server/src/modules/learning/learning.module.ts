import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { NavigationModule } from '../navigation/navigation.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { LearningProject } from './learning-project.entity';
import { LearningProjectController } from './learning-project.controller';
import { LearningProjectRepository } from './learning-project.repository';
import { LearningProjectService } from './learning-project.service';

@Module({
  imports: [
    NavigationModule,
    WorkspaceModule,
    TypegooseModule.forFeature([LearningProject]),
  ],
  controllers: [LearningProjectController],
  providers: [LearningProjectRepository, LearningProjectService],
  exports: [LearningProjectRepository, LearningProjectService],
})
export class LearningModule {}
