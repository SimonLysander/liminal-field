/**
 * SettingsModule — 系统设置与灾难恢复模块。
 *
 * 架构定位：顶层聚合模块，与 WorkspaceModule 平行。
 * - 同时依赖 ContentModule（内容存储层）和 NavigationModule（导航索引层）
 * - ManifestService / RecoveryService 放在此模块而非 ContentModule，
 *   因为 NavigationModule 已经导入了 ContentModule，若 ContentModule 再导入
 *   NavigationModule 会产生循环依赖。
 *
 * 导出：
 * - ManifestService：供 AuthModule 在 syncToRemote 前写入清单
 */
import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { ManifestService } from './manifest.service';
import { RecoveryService } from './recovery.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [ContentModule, NavigationModule],
  controllers: [SettingsController],
  providers: [ManifestService, RecoveryService],
  exports: [ManifestService, RecoveryService],
})
export class SettingsModule {}
