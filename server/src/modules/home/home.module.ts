import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { HomeController } from './home.controller';

@Module({
  imports: [ContentModule, NavigationModule, WorkspaceModule],
  controllers: [HomeController],
})
export class HomeModule {}
