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
 *   - processed_feed_items：工作流命中条目（去重 + 历史查询）
 *   - digest_tasks：工作流任务状态（graph state 持久化 + 前端可查）
 *   - navigation_nodes (scope='digest')：事项 = 根节点，报告 = 子节点（复用现有表）
 *   - content_items / content_snapshots：报告正文 + 版本（完全复用）
 *
 * PromptManagerModule 是 @Global()，已在 AppModule 导入，这里无需重复 import。
 * SettingsModule（SystemConfigService）也是 @Global()，无需重复 import。
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';

import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { SettingsModule } from '../settings/settings.module';

import { InfoSource } from './info-source.entity';
import { InfoSourceRepository } from './info-source.repository';
import { InfoSourceService } from './info-source.service';
import { InfoSourceController } from './info-source.controller';

import { SmartTopicConfig } from './smart-topic-config.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';

import { ProcessedFeedItem } from './processed-feed-item.entity';
import { ProcessedFeedItemRepository } from './processed-feed-item.repository';

import { DigestTask } from './digest-task.entity';
import { DigestTaskRepository } from './digest-task.repository';

import { DigestReport } from './digest-report.entity';
import { DigestReportRepository } from './digest-report.repository';
import { DigestReportMigrationService } from './digest-report-migration.service';

import { TopicService } from './topic.service';
import { TopicController } from './topic.controller';

import { RssFetcher } from './fetchers/rss-fetcher.service';
import { FetcherRegistry } from './fetchers/fetcher-registry.service';
import { DigestToolsFactory } from './tools/digest-tools.factory';

import { ReactAgentNode } from './workflow/nodes/react-agent.node';
import { ComposeNode } from './workflow/nodes/compose.node';
import { CommitNode } from './workflow/nodes/commit.node';
import { DigestWorkflowService } from './workflow/digest-workflow.service';
import { DigestWorkflowController } from './digest-workflow.controller';
import { DigestPublicController } from './digest-public.controller';
import { DigestPublicService } from './digest-public.service';
import { DigestSchedulerService } from './digest-scheduler.service';

@Module({
  imports: [
    TypegooseModule.forFeature([
      InfoSource,
      SmartTopicConfig,
      ProcessedFeedItem,
      DigestTask,
      DigestReport,
    ]),
    ContentModule,
    NavigationModule,
    SettingsModule,
  ],
  controllers: [
    InfoSourceController,
    TopicController,
    DigestWorkflowController,
    DigestPublicController,
  ],
  providers: [
    InfoSourceRepository,
    InfoSourceService,
    SmartTopicConfigRepository,
    ProcessedFeedItemRepository,
    DigestTaskRepository,
    DigestReportRepository,
    TopicService,
    RssFetcher,
    FetcherRegistry,
    DigestToolsFactory,
    // workflow nodes
    ReactAgentNode,
    ComposeNode,
    CommitNode,
    DigestWorkflowService,
    // scheduler（onModuleInit 时注册所有 enabled cron job）
    DigestSchedulerService,
    // 公开端服务
    DigestPublicService,
    // 一次性迁移老 ContentItem 时代的 digest 报告(onModuleInit 自动跑)
    DigestReportMigrationService,
  ],
  exports: [
    InfoSourceRepository,
    InfoSourceService,
    SmartTopicConfigRepository,
    ProcessedFeedItemRepository,
    DigestTaskRepository,
    DigestReportRepository,
    TopicService,
    FetcherRegistry,
    DigestToolsFactory,
    DigestWorkflowService,
    DigestSchedulerService,
  ],
})
export class DigestModule {}
