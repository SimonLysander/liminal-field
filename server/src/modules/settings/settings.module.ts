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
// WorkspaceModule:PublishAllService 需要 AnthologyViewService。无循环依赖
// (WorkspaceModule 不 import SettingsModule)。
import { WorkspaceModule } from '../workspace/workspace.module';
// SkillModule:SystemConfigService 保存 agentConfigs 时校验 skill.requiredTools ⊆ agent.tools,
// 同时监听 skill.deleted 事件级联清理 enabledSkillIds 引用(Task 0.5 / 0.6)。
import { SkillModule } from '../skill/skill.module';
import { SystemConfig } from './system-config.entity';
// EditorDraft / AgentMemory:LocalResetService 经 forFeature 直接持有其 model,
// 用于「清空本地」时连带清草稿与 session 记忆(不能 import AgentModule——它已 import 本模块,会循环)。
import { EditorDraft } from '../workspace/editor-draft.entity';
import { AgentMemory } from '../agent/memory/agent-memory.entity';
import { SystemConfigRepository } from './system-config.repository';
import { SystemConfigService } from './system-config.service';
import { ManifestService } from './manifest.service';
import { RecoveryService } from './recovery.service';
import { ArchiveService } from './archive.service';
import { LocalResetService } from './local-reset.service';
import { PublishAllService } from './publish-all.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [
    TypegooseModule.forFeature([SystemConfig, EditorDraft, AgentMemory]),
    ContentModule,
    NavigationModule,
    OssModule,
    WorkspaceModule,
    SkillModule,
  ],
  controllers: [SettingsController],
  providers: [
    SystemConfigRepository,
    SystemConfigService,
    ManifestService,
    RecoveryService,
    ArchiveService,
    LocalResetService,
    PublishAllService,
  ],
  exports: [
    ManifestService,
    RecoveryService,
    SystemConfigService,
    SystemConfigRepository,
  ],
})
export class SettingsModule {}
