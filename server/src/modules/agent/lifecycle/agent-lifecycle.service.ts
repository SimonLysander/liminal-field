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
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionHandler } from './session.handler';
import { MemoryHandler } from './memory.handler';
import { PromptHandler, type BuildSystemPromptParams } from './prompt.handler';
import { ToolAssembler } from './tool.assembler';
import { SystemConfigService } from '../../settings/system-config.service';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { AgentSessionRepository } from '../session/agent-session.repository';
import { AnthologyViewService } from '../../workspace/anthology-view.service';
import { MemoryObserverService } from '../memory/memory-observer.service';
import { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import { sliceSessionPage } from './session-pagination';
import type { AgentChatDto } from '../dto/agent-chat.dto';

/** 跨段聚合分页默认每页条数 */
const SESSION_PAGE_LIMIT = 50;

@Injectable()
export class AgentLifecycle {
  private readonly logger = new Logger(AgentLifecycle.name);

  constructor(
    private readonly session: SessionHandler,
    private readonly memory: MemoryHandler,
    private readonly prompt: PromptHandler,
    private readonly tools: ToolAssembler,
    private readonly eventEmitter: EventEmitter2,
    private readonly systemConfigService: SystemConfigService,
    // 直接注入记忆 repository:session 记忆(content + tasks)是草稿级,
    // 由 agentKey(=entryContext.sessionKey)定位,MemoryHandler 只管 user 记忆全文加载
    private readonly memoryRepo: AgentMemoryRepository,
    // 跨段聚合分页：getAllMessages 跨段全量后内存 slice（对话量可控，YAGNI）
    private readonly sessionRepo: AgentSessionRepository,
    // #150 续:文集场景在 onBeforeChat 里按需查整集脉络,前端不再透传 collectionContext
    private readonly anthology: AnthologyViewService,
    // 2026-05-30 续:潜意识观察者,onAfterChat 主路径同步跑(让下一轮 prompt 看到新塑形)
    private readonly observer: MemoryObserverService,
    // 2026-05-30 续:onBeforeChat 读 current_view 注入 <memories_index>
    private readonly observationRepo: AgentMemoryObservationRepository,
  ) {}

  /**
   * 会话加载钩子：前端打开对话时调用，支持跨段聚合分页。
   *
   * 分页设计（游标：绝对 index）：
   * - 无 before：返回最近 limit 条（初始加载，最新一页）
   * - 有 before：返回 before index 之前的 limit 条（懒加载更早历史）
   * 实现：getAllMessages 全量加载后内存 slice，agent 对话量可控（YAGNI，真很大再优化）。
   *
   * 返回的 summary = 本草稿 session 记忆 content(对话脉络);tasks = session 记忆的写作计划。
   * 不再有 totalRounds(轮数概念已废弃)。
   */
  async onSessionLoad(
    sessionKey: string,
    /** 分页游标：返回此绝对 index 之前的消息；无则取最近 limit 条 */
    before?: number,
    /** 每页条数，默认 SESSION_PAGE_LIMIT */
    limit: number = SESSION_PAGE_LIMIT,
    agentInstanceKey?: string,
  ): Promise<{
    sessionKey: string;
    messages: Record<string, unknown>[];
    /** 是否还有更早的消息（前端据此决定是否显示"加载更多"） */
    hasMore: boolean;
    /** 当前返回的第一条消息的绝对 index（前端下次懒加载传 before=firstIndex） */
    firstIndex: number;
    /** session 记忆 content（对话脉络，由 compaction 提炼） */
    summary: string;
    tasks: Array<Record<string, unknown>>;
    lastActiveAt: Date | null;
  }> {
    const memoryKey = agentInstanceKey ?? sessionKey;
    // 并行加载：全量消息（分页用）+ session 记忆（脉络/tasks）+ 最新段（lastActiveAt）
    const [allMessages, sessionMem, latestSeg] = await Promise.all([
      this.sessionRepo.getAllMessages(sessionKey),
      this.memoryRepo.findSession(memoryKey),
      this.sessionRepo.findLatestSeg(sessionKey),
    ]);

    // 内存分页：before 是绝对 index（全量数组下标），纯函数 sliceSessionPage 算切片
    const page = sliceSessionPage(allMessages, before, limit);

    return {
      sessionKey,
      messages: page.messages,
      hasMore: page.hasMore,
      firstIndex: page.firstIndex,
      // summary 字段沿用返回结构,值即 session 记忆 content(脉络)
      summary: sessionMem?.content ?? '',
      tasks: (sessionMem?.tasks as Array<Record<string, unknown>>) ?? [],
      lastActiveAt: latestSeg?.lastActiveAt ?? null,
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
    // agentKey = 草稿级 agent 实例标识；sessionKey 只表示当前业务聊天。
    const agentKey =
      dto.entryContext.agentInstanceKey ?? dto.entryContext.sessionKey;
    // 并行加载:user 记忆全文(降级) + 所有者身份 + 本草稿 session 记忆 + 当前画像(新主路径)
    const [coreMemories, ownerProfile, sessionMem, currentView] =
      await Promise.all([
        this.memory.loadCore(),
        this.systemConfigService.getOwnerProfile(),
        agentKey
          ? this.memoryRepo.findSession(agentKey)
          : Promise.resolve(null),
        this.observationRepo.findCurrentView(),
      ]);

    // tasks 从 session 记忆记录取(替代旧 AgentSession.tasks);content 注入对话脉络
    const tasks = (sessionMem?.tasks as Array<Record<string, unknown>>) ?? [];

    // 文集条目场景 → 后端按需查整集脉络(#150 续,2026-05-31):
    // 前端不再每轮重发 collectionContext,后端拿到 contentItemId(含 `:`) 自己拼。
    // 笔记场景 contentItemId 无 `:`,buildCollectionContextForEntry 返 null。
    // 显式声明成 prompt 期望的 document 类型(含 collectionContext),DTO 已不带这字段
    let document: BuildSystemPromptParams['document'] =
      dto.entryContext.document;
    if (document?.contentItemId.includes(':')) {
      const collectionContext =
        await this.anthology.buildCollectionContextForEntry(
          document.contentItemId,
        );
      if (collectionContext) {
        document = { ...document, collectionContext };
      }
    }

    const systemPrompt = this.prompt.buildSystemPrompt({
      ownerProfile: ownerProfile.name ? ownerProfile : undefined,
      coreMemories,
      // 2026-05-30 主路径:observer 派生的 markdown(无值时降级用 coreMemories 标题索引)
      memoriesView: currentView?.markdown,
      // session 记忆 content = 旧对话提炼出的会话脉络
      sessionMemory: sessionMem?.content || undefined,
      document,
      gallery: dto.entryContext.gallery,
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
    sessionKey: string,
    newMessages: Record<string, unknown>[],
    window: number,
    agentInstanceKey?: string,
  ): Promise<void> {
    const memoryKey = agentInstanceKey ?? sessionKey;
    // 持久化失败必须显式记录:本钩子在 streamText.onFinish 里被 void 调用,
    // 若 session.save 抛错(Mongo 瞬时故障等)且不捕获,本轮对话会静默丢失
    // (append-only 历史缺这一轮),还会产生进程级 unhandledRejection。
    try {
      await this.session.save(sessionKey, newMessages);
    } catch (err) {
      this.logger.error(
        `onAfterChat 持久化失败 sessionKey=${sessionKey}: 本轮 ${newMessages.length} 条消息未入库`,
        err instanceof Error ? err.stack : String(err),
      );
      return; // 未成功持久化则不触发 compaction(无新内容可压缩)
    }
    // 潜意识观察(2026-05-30, #150 续):同步 await 让下一轮 prompt 看到新塑形。
    // observer 内部 catch 所有错误返 {observationsAdded:0},绝不阻塞用户。
    // 但仍包一层 try 防御:意外抛出时只 log,不影响 compaction 事件。
    try {
      await this.observer.observe(newMessages, sessionKey);
    } catch (err) {
      this.logger.error(
        `onAfterChat observer 异常(理论上 observer 已 catch,这里是兜底): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.eventEmitter.emit('agent.afterChat', {
      agentKey: memoryKey,
      sessionKey,
      window,
    });
  }

  /** 获取草稿 session 记忆中的 tasks(保存后返回给前端刷新 TaskBar) */
  async getSessionTasks(
    agentKey: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.memoryRepo.getTasks(agentKey);
  }

  async listBusinessSessions(agentInstanceKey: string) {
    return this.sessionRepo.listBusinessSessions(agentInstanceKey);
  }

  async renameBusinessSession(sessionKey: string, title: string) {
    await this.sessionRepo.renameBusinessSession(sessionKey, title);
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
