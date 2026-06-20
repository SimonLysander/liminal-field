/**
 * DigestModule — 智能小应用 · 自动信息收集。
 *
 * 架构定位（参照 workspace.module 的三层架构）：
 *   - ContentModule（纯存储 Git + MongoDB）+ NavigationModule（业务索引）= 基础设施
 *   - DigestModule 是「业务模块」，跟 WorkspaceModule 平级（不互相依赖）
 *   - 提供：信息源 CRUD + 智能事项 CRUD + 工作流（拉源 → AI 判定 → 入 digest scope）
 *
 * 数据库表：
 *   - info_sources：信息源（全局共用，无 scope）
 *   - smart_topic_configs：事项配置（绑事项容器 ContentItem.id）
 *   - navigation_nodes (scope='digest')：事项 = 根节点，报告 = 子节点（复用现有表）
 *   - content_items / content_snapshots：报告正文 + 版本（完全复用）
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';

import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';

import { InfoSource } from './info-source.entity';
import { InfoSourceRepository } from './info-source.repository';
import { InfoSourceService } from './info-source.service';
import { InfoSourceController } from './info-source.controller';

import { SmartTopicConfig } from './smart-topic-config.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';

import { TopicService } from './topic.service';
import { TopicController } from './topic.controller';

@Module({
  imports: [
    TypegooseModule.forFeature([InfoSource, SmartTopicConfig]),
    ContentModule,
    NavigationModule,
  ],
  controllers: [InfoSourceController, TopicController],
  providers: [
    InfoSourceRepository,
    InfoSourceService,
    SmartTopicConfigRepository,
    TopicService,
  ],
  exports: [
    InfoSourceRepository,
    InfoSourceService,
    SmartTopicConfigRepository,
    TopicService,
  ],
})
export class DigestModule {}
