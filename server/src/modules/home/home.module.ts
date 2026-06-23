import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { DigestSharedModule } from '../digest/digest-shared.module';
import { HomeController } from './home.controller';

@Module({
  // DigestSharedModule 提供 DigestReportRepository（首页简报摘要聚合用）
  imports: [ContentModule, NavigationModule, WorkspaceModule, DigestSharedModule],
  controllers: [HomeController],
})
export class HomeModule {}
