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

@Module({
  imports: [
    // EventEmitter 在模块级注册（app.module.ts 未全局注册）
    EventEmitterModule.forRoot(),
    TypegooseModule.forFeature([AgentMemory, AgentSession]),
    ContentModule,
    WorkspaceModule,
    SettingsModule,
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
    AgentSessionRepository,
    CompactionService,
    MemoryAgentService,
    SubAgentService,
  ],
})
export class AgentModule {}
