/**
 * DigestModule — 智能小应用 · 自动信息收集。
 *
 * 架构定位:
 *   - DigestSharedModule (底层): 各 entity 的 repo + RSS fetcher,无业务,
 *     供 agent 模块的 ToolCatalog 也使用(避免 agent → digest 循环依赖)
 *   - DigestModule (本模块,业务层): 控制器 + service + workflow,依赖 shared + agent
 *   - AgentModule 提供 ToolResolver 装配工具(P3 重构)
 */
import { Module } from '@nestjs/common';

import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { SettingsModule } from '../settings/settings.module';
// P3 重构:workflow 跑 react-agent 现在走 agent 的 ToolAssembler 统一装配工具
import { AgentModule } from '../agent/agent.module';

import { DigestSharedModule } from './digest-shared.module';

import { InfoSourceService } from './info-source.service';
import { InfoSourceController } from './info-source.controller';

import { TopicService } from './topic.service';
import { TopicController } from './topic.controller';

import { ReactAgentNode } from './workflow/nodes/react-agent.node';
import { ComposeNode } from './workflow/nodes/compose.node';
import { CommitNode } from './workflow/nodes/commit.node';
import { DigestWorkflowService } from './workflow/digest-workflow.service';
import { DigestWorkflowController } from './digest-workflow.controller';
import { DigestPublicModule } from './digest-public.module';
import { DigestSchedulerService } from './digest-scheduler.service';

@Module({
  imports: [
    DigestSharedModule,
    DigestPublicModule,
    ContentModule,
    NavigationModule,
    SettingsModule,
    AgentModule,
  ],
  controllers: [
    InfoSourceController,
    TopicController,
    DigestWorkflowController,
  ],
  providers: [
    InfoSourceService,
    TopicService,
    // workflow nodes
    ReactAgentNode,
    ComposeNode,
    CommitNode,
    DigestWorkflowService,
    // scheduler(onModuleInit 时注册所有 enabled cron job)
    DigestSchedulerService,
  ],
  exports: [
    InfoSourceService,
    TopicService,
    DigestWorkflowService,
    DigestSchedulerService,
    // 共享层导出穿透:让其他模块只 import DigestModule 也能拿到 repo
    DigestSharedModule,
    DigestPublicModule,
  ],
})
export class DigestModule {}
