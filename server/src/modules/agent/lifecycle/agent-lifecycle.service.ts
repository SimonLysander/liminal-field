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
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
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
    // 直接注入记忆 repository:session 记忆(content + tasks)是草稿级,
    // 由 agentKey(=entryContext.sessionKey)定位,不经 MemoryHandler 的全局召回路径
    private readonly memoryRepo: AgentMemoryRepository,
  ) {}

  /**
   * 会话加载钩子：前端打开对话时调用。
   * 同时触发自动召回——如果有文档标题，尝试找到相关 project 记忆。
   * autoRecall 失败降级为空数组，不影响会话加载。
   */
  async onSessionLoad(
    agentKey: string,
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
    // 新架构:消息跨段聚合(此处取最近一段额度;完整聚合分页留到 U5),
    // 会话脉络与 tasks 来自草稿 session 记忆记录(agentKey 定位)。
    const [sessionData, sessionMem] = await Promise.all([
      this.session.load(agentKey),
      this.memoryRepo.findSession(agentKey),
    ]);

    let relatedMemories: AgentMemory[] = [];
    try {
      relatedMemories = await this.memory.autoRecall(documentTitle);
    } catch {
      // 自动召回失败不影响会话加载，降级为空数组
    }

    return {
      sessionKey: agentKey,
      messages: sessionData.messages,
      // summary 字段沿用返回结构,值改为 session 记忆 content(脉络);totalRounds 过渡保留为消息条数
      summary: sessionMem?.content ?? '',
      totalRounds: sessionData.totalRounds,
      tasks: (sessionMem?.tasks as Array<Record<string, unknown>>) ?? [],
      lastActiveAt: sessionData.lastActiveAt,
      relatedMemories,
    };
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
    // agentKey = 草稿级标识(现阶段即 entryContext.sessionKey 的值;前端字段改名留到 U7)
    const agentKey = dto.entryContext.sessionKey;
    // 并行加载:user 记忆全文 + project 索引 + 所有者身份 + 本草稿 session 记忆(content + tasks)
    const [coreMemories, indexMemories, ownerProfile, sessionMem] =
      await Promise.all([
        this.memory.loadCore(),
        this.memory.loadIndex(),
        this.systemConfigService.getOwnerProfile(),
        agentKey
          ? this.memoryRepo.findSession(agentKey)
          : Promise.resolve(null),
      ]);

    // tasks 从 session 记忆记录取(替代旧 AgentSession.tasks);content 替代旧 sessionSummary 注入
    const tasks = (sessionMem?.tasks as Array<Record<string, unknown>>) ?? [];

    const systemPrompt = this.prompt.buildSystemPrompt({
      ownerProfile: ownerProfile.name ? ownerProfile : undefined,
      coreMemories,
      indexMemories,
      relatedMemories: dto.relatedMemories,
      // session 记忆 content = 旧对话提炼出的会话脉络,替代旧 sessionSummary
      sessionMemory: sessionMem?.content || undefined,
      document: dto.entryContext.document,
      customSystemPrompt: aiConfig.aiSystemPrompt,
      entrySystemPrompt: aiConfig.entrySystemPrompt,
      tasks,
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
   * 对话完成钩子:append 新增消息 + 发送异步 compaction 事件。
   *
   * 原文 append-only:只追加本轮新增消息(分段由 repository 自动管理),永不覆盖删除。
   * window 随事件带出,供 compaction 按 token 占比判断是否触发(后台,不阻塞响应)。
   */
  async onAfterChat(
    agentKey: string,
    newMessages: Record<string, unknown>[],
    window: number,
  ): Promise<void> {
    await this.session.save(agentKey, newMessages);
    this.eventEmitter.emit('agent.afterChat', { agentKey, window });
  }

  /** 获取草稿 session 记忆中的 tasks(保存后返回给前端刷新 TaskBar) */
  async getSessionTasks(
    agentKey: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.memoryRepo.getTasks(agentKey);
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
