/**
 * AgentModule — AI 写作顾问模块。
 *
 * 模块分层：
 * - Handler 层：SessionHandler / MemoryHandler / PromptHandler / ToolAssembler
 *   各司其职，单一职责，可单独测试
 * - 编排层：AgentLifecycle
 *   把 Handler 编排成生命周期钩子，上层只调用钩子
 * - 异步监听：CompactionListener / ToolUseListener
 *   通过 @nestjs/event-emitter 与主流程解耦
 * - 底层：AgentService / AgentSessionRepository / AgentMemoryRepository / CompactionService
 *
 * 依赖外部模块：
 * - ContentModule：提供 ContentService（知识库搜索）
 * - WorkspaceModule：提供 NoteViewService（读取文档正文）
 * - SettingsModule：提供 SystemConfigService（读取 AI 配置）
 *
 * EventEmitter：
 * 在此模块注册 EventEmitterModule.forRoot()。
 * app.module.ts 未全局注册，如后续需全局共享可迁移过去。
 *
 * 对外不导出服务——Agent 功能仅通过 HTTP 接口暴露，不被其他模块复用。
 */
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypegooseModule } from 'nestjs-typegoose';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentMemory } from './memory/agent-memory.entity';
import { AgentMemoryRepository } from './memory/agent-memory.repository';
import { PendingWrite } from './approval/pending-write.entity';
import { PendingWriteRepository } from './approval/pending-write.repository';
import { PendingWriteCommitService } from './approval/pending-write.service';
import {
  AgentMemoryObservation,
  AgentMemoryCurrentView,
} from './memory/agent-memory-observation.entity';
import { AgentMemoryObservationRepository } from './memory/agent-memory-observation.repository';
import { MemoryViewService } from './memory/memory-view.service';
import { AgentSession } from './session/agent-session.entity';
import { AgentSessionRepository } from './session/agent-session.repository';
import { CompactionService } from './session/compaction.service';
import { MemoryAgentService } from './memory/memory-agent.service';
import { SubAgentService } from './sub-agent/sub-agent.service';
import { SessionHandler } from './lifecycle/session.handler';
import { MemoryHandler } from './lifecycle/memory.handler';
import { PromptHandler } from './lifecycle/prompt.handler';
import { ToolAssembler } from './lifecycle/tool.assembler';
import { AgentLifecycle } from './lifecycle/agent-lifecycle.service';
import { CompactionListener } from './listeners/compaction.listener';
import { ToolUseListener } from './listeners/tool-use.listener';
import { ContentModule } from '../content/content.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SettingsModule } from '../settings/settings.module';
// SkillModule:暴露 SkillService 供 ToolAssembler / PromptHandler 注入(Skill 工具 + <available_skills>)
import { SkillModule } from '../skill/skill.module';
// P3 重构:browse/pick 工具归 agent/tools/,需要 digest 的 repo + RssFetcher → 走 SharedModule
import { DigestSharedModule } from '../digest/digest-shared.module';

@Module({
  imports: [
    // EventEmitter 在模块级注册（app.module.ts 未全局注册）。
    // maxListeners 调高(默认 10):每个 sub-agent-progress SSE 订阅给同一 emitter
    // 加 2 个 listener(step+done),多标签页/并发订阅 ≥5 个就会触发
    // MaxListenersExceededWarning。断开时 teardown 会正确移除,无真实泄漏。
    EventEmitterModule.forRoot({ maxListeners: 50 }),
    TypegooseModule.forFeature([
      AgentMemory,
      AgentSession,
      AgentMemoryObservation,
      AgentMemoryCurrentView,
      PendingWrite,
    ]),
    ContentModule,
    WorkspaceModule,
    SettingsModule,
    SkillModule,
    DigestSharedModule,
  ],
  controllers: [AgentController],
  providers: [
    // Handler 层：各司其职的单一职责服务
    SessionHandler,
    MemoryHandler,
    PromptHandler,
    ToolAssembler,
    // 编排层：生命周期钩子编排
    AgentLifecycle,
    // 异步监听：事件驱动的后处理
    CompactionListener,
    ToolUseListener,
    // 底层服务与仓储
    AgentService,
    AgentMemoryRepository,
    AgentMemoryObservationRepository,
    AgentSessionRepository,
    PendingWriteRepository,
    PendingWriteCommitService,
    CompactionService,
    MemoryAgentService,
    MemoryViewService,
    SubAgentService,
  ],
  exports: [
    // ToolAssembler 给 digest workflow 用(P3 重构:工具池全项目共有)
    ToolAssembler,
  ],
})
export class AgentModule {}
