/**
 * DigestModule — 智能小应用 · 自动信息收集。
 *
 * 架构定位（参照 workspace.module 的三层架构）：
 *   - ContentModule（纯存储 Git + MongoDB）+ NavigationModule（业务索引）= 基础设施
 *   - DigestModule 是「业务模块」，跟 WorkspaceModule 平级（不互相依赖）
 *   - 提供：信息源 CRUD + 智能事项 CRUD + 工作流（拉源 → AI 判定 → 入 digest scope）
 *
 * 骨架阶段（task #32）只暴露 entity + repository。
 * Controller / Service / Workflow 在 task #34-37 逐步填充。
 *
 * 数据库表：
 *   - info_sources：信息源（全局共用，无 scope）
 *   - smart_topic_configs：事项配置（绑事项容器 ContentItem.id）
 *   - navigation_nodes (scope='digest')：事项 = 根节点，报告 = 子节点（复用现有表）
 *   - content_items / content_snapshots：报告正文 + 版本（完全复用）
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';

import { InfoSource } from './info-source.entity';
import { InfoSourceRepository } from './info-source.repository';
import { SmartTopicConfig } from './smart-topic-config.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';

@Module({
  imports: [TypegooseModule.forFeature([InfoSource, SmartTopicConfig])],
  providers: [InfoSourceRepository, SmartTopicConfigRepository],
  exports: [InfoSourceRepository, SmartTopicConfigRepository],
})
export class DigestModule {}
