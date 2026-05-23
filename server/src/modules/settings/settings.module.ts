/**
 * SettingsModule — 系统设置模块。
 *
 * 依赖：ContentModule（内容存储层）、NavigationModule（导航层）、OssModule（对象存储）。
 * SystemConfig 持久化全部系统配置到 MongoDB。
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { OssModule } from '../oss/oss.module';
import { SystemConfig } from './system-config.entity';
// EditorDraft / AgentMemory:LocalResetService 经 forFeature 直接持有其 model,
// 用于「清空本地」时连带清草稿与 project 记忆(不能 import AgentModule——它已 import 本模块,会循环)。
import { EditorDraft } from '../workspace/editor-draft.entity';
import { AgentMemory } from '../agent/memory/agent-memory.entity';
import { SystemConfigRepository } from './system-config.repository';
import { SystemConfigService } from './system-config.service';
import { ManifestService } from './manifest.service';
import { RecoveryService } from './recovery.service';
import { ArchiveService } from './archive.service';
import { LocalResetService } from './local-reset.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [
    TypegooseModule.forFeature([SystemConfig, EditorDraft, AgentMemory]),
    ContentModule,
    NavigationModule,
    OssModule,
  ],
  controllers: [SettingsController],
  providers: [
    SystemConfigRepository,
    SystemConfigService,
    ManifestService,
    RecoveryService,
    ArchiveService,
    LocalResetService,
  ],
  exports: [
    ManifestService,
    RecoveryService,
    SystemConfigService,
    SystemConfigRepository,
  ],
})
export class SettingsModule {}
