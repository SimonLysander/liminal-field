import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { HomeController } from './home.controller';

@Module({
  imports: [ContentModule, WorkspaceModule],
  controllers: [HomeController],
})
export class HomeModule {}
