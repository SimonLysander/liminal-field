/**
 * AgentLifecycle — Agent 生命周期编排层。
 *
 * 职责：
 * 把各 Handler 的能力编排成几个关键生命周期钩子，
 * 上层（AgentController / AgentService）只调用这些钩子，
 * 不直接操作 Handler 或 Repository。
 *
 * 生命周期钩子：
 * - onSessionLoad：加载会话 + 自动召回相关记忆
 * - onBeforeChat：构建 systemPrompt + 组装 tools
 * - onAfterChat：持久化消息 + 发送 agent.afterChat 异步事件
 *
 * 异步事件：
 * - agent.afterChat    → CompactionListener（触发 compaction 检查）
 * - agent.afterToolUse → ToolUseListener（记录工具调用日志）
 */
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionHandler } from './session.handler';
import { MemoryHandler } from './memory.handler';
import { PromptHandler } from './prompt.handler';
import { ToolAssembler } from './tool.assembler';
import { SystemConfigService } from '../../settings/system-config.service';
import type { AgentMemory } from '../memory/agent-memory.entity';
import type { AgentChatDto } from '../dto/agent-chat.dto';

@Injectable()
export class AgentLifecycle {
  constructor(
    private readonly session: SessionHandler,
    private readonly memory: MemoryHandler,
    private readonly prompt: PromptHandler,
    private readonly tools: ToolAssembler,
    private readonly eventEmitter: EventEmitter2,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * 会话加载钩子：前端打开对话时调用。
   * 同时触发自动召回——如果有文档标题，尝试找到相关 project 记忆。
   * autoRecall 失败降级为空数组，不影响会话加载。
   */
  async onSessionLoad(
    sessionKey: string,
    documentTitle?: string,
  ): Promise<{
    sessionKey: string;
    messages: Record<string, unknown>[];
    summary: string;
    totalRounds: number;
    tasks: Array<Record<string, unknown>>;
    lastActiveAt: Date | null;
    relatedMemories: AgentMemory[];
  }> {
    const sessionData = await this.session.load(sessionKey);

    let relatedMemories: AgentMemory[] = [];
    try {
      relatedMemories = await this.memory.autoRecall(documentTitle);
    } catch {
      // 自动召回失败不影响会话加载，降级为空数组
    }

    return { sessionKey, ...sessionData, relatedMemories };
  }

  /**
   * 对话前钩子：构建系统提示词 + 组装工具集。
   * 并行加载 core / index 记忆以减少延迟。
   *
   * aiConfig 包含三层 prompt 来源：
   * - aiSystemPrompt：用户在设置中配置的全局自定义提示词
   * - entrySystemPrompt：AgentEntryConfig 里为该 agent 入口配置的提示词
   * - allowedTools：入口配置的工具白名单，未配置时使用全部工具
   */
  async onBeforeChat(
    dto: AgentChatDto,
    aiConfig: {
      aiSystemPrompt?: string;
      entrySystemPrompt?: string;
      allowedTools?: string[];
      tier?: string;
    },
  ): Promise<{
    systemPrompt: string;
    tools: Record<string, any>;
  }> {
    // 并行加载记忆 + 所有者身份
    const [coreMemories, indexMemories, ownerProfile] = await Promise.all([
      this.memory.loadCore(),
      this.memory.loadIndex(),
      this.systemConfigService.getOwnerProfile(),
    ]);

    const systemPrompt = this.prompt.buildSystemPrompt({
      ownerProfile: ownerProfile.name ? ownerProfile : undefined,
      coreMemories,
      indexMemories,
      relatedMemories: dto.relatedMemories,
      sessionSummary: dto.sessionSummary ?? undefined,
      document: dto.entryContext.document,
      customSystemPrompt: aiConfig.aiSystemPrompt,
      entrySystemPrompt: aiConfig.entrySystemPrompt,
    });

    // allowedTools 为空时使用全部工具；有白名单时按白名单过滤
    const tools = this.tools.assemble(
      dto.entryContext,
      aiConfig.allowedTools,
      aiConfig.tier,
    );

    return { systemPrompt, tools };
  }

  /**
   * 对话完成钩子：持久化消息 + 发送异步事件。
   * compaction 等后处理通过事件异步执行，不阻塞响应。
   */
  async onAfterChat(
    sessionKey: string,
    messages: Record<string, unknown>[],
  ): Promise<void> {
    await this.session.save(sessionKey, messages);
    this.eventEmitter.emit('agent.afterChat', { sessionKey, messages });
  }

  /** 获取会话中的 tasks（保存后返回给前端刷新 TaskBar） */
  async getSessionTasks(sessionKey: string): Promise<Array<Record<string, unknown>>> {
    const tasks = await this.session.getTasks(sessionKey);
    return tasks;
  }

  /**
   * 删除会话钩子：清空对话历史。
   */
  async onSessionDelete(sessionKey: string): Promise<void> {
    await this.session.delete(sessionKey);
  }

  /**
   * 工具调用事件发射：供 AgentService 在 onStepFinish 回调里调用。
   * 封装在 lifecycle 上，避免 AgentService 直接依赖 EventEmitter2。
   */
  emitAfterToolUse(
    stepNumber: number,
    toolCalls: Array<{ toolName: string }>,
  ): void {
    this.eventEmitter.emit('agent.afterToolUse', { stepNumber, toolCalls });
  }
}
