# Agent Hooks 系统设计

> 状态：设计中 | 创建：2026-05-21

---

## 为什么需要 Hooks

当前 agent 的所有逻辑都写死在 controller 和 service 里，没有生命周期概念。导致：

- 记忆的 recall 只能靠 agent 主动调工具，系统不会自动加载
- compaction 写死在 controller 的 PUT 端点里，不是可插拔的
- 没有"session 开始时做点什么"的能力
- 新增的自动化行为没有统一的挂载点

Hooks 是 agent 生命周期的骨架，工具系统、记忆系统、compaction 都挂在上面。

---

## 设计原则

### 1. 同步流水线 + 异步事件，分开处理

两种 hook 性质不同，用不同的机制：
- **同步流水线**（SessionLoad、BeforeChat）：输出给下一步用，必须等完成。用**组合式 Handler** 编排。
- **异步副作用**（AfterChat、AfterToolUse）：fire-and-forget，不阻塞。用 **@nestjs/event-emitter** 解耦。

### 2. 每个关注点是独立的 Handler

不是一个大 service 装所有逻辑。session 管理、记忆加载、prompt 构建、工具组装——各自是独立的 `@Injectable()` 类，AgentLifecycle 负责编排。

### 3. 异步副作用通过事件解耦

compaction、未来的自动记忆提取——通过 `@OnEvent` 监听。加新行为只需加一个 listener，不改 lifecycle 核心。

### 4. Hook 失败不阻塞主流程

同步 handler 中的非关键步骤（如 auto-recall）失败 → catch + 降级，不阻止用户正常对话。

---

## 技术架构

### 总览

```
┌─ 同步流水线（组合式 Handler）──────────────────────┐
│                                                     │
│  AgentLifecycle（编排层，不含业务逻辑）               │
│    ├── onSessionLoad()  编排 Session + Memory 的同步调用
│    └── onBeforeChat()   编排 Memory + Prompt + Tool 的同步调用
│                                                     │
│  Handler 层（各司其职的 @Injectable）                 │
│    ├── SessionHandler    session 的 load / save      │
│    ├── MemoryHandler     记忆的 loadCore / loadIndex / autoRecall
│    ├── PromptHandler     system prompt 构建          │
│    └── ToolAssembler     工具集组装                   │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─ 异步副作用（@nestjs/event-emitter）────────────────┐
│                                                     │
│  事件                        监听者                  │
│  'agent.afterChat'     →    CompactionListener      │
│  'agent.afterToolUse'  →    （v1 预留）              │
│  'agent.sessionSaved'  →    （未来可加新 listener）   │
│                                                     │
│  加新行为 = 加一个 @OnEvent 的类，不改任何现有代码     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Handler 层

每个 handler 是一个 `@Injectable()` 类，职责单一，可独立测试。

```typescript
/** session 的存取 */
@Injectable()
export class SessionHandler {
  constructor(private readonly sessionRepo: AgentSessionRepository) {}

  async load(sessionKey: string): Promise<SessionData> {
    const session = await this.sessionRepo.findByKey(sessionKey);
    return {
      messages: session?.messages ?? [],
      summary: session?.summary ?? '',
      totalRounds: session?.totalRounds ?? 0,
      lastActiveAt: session?.lastActiveAt ?? null,
    };
  }

  async save(sessionKey: string, messages: Record<string, unknown>[]): Promise<void> {
    const totalRounds = messages.filter(m => m.role === 'assistant').length;
    await this.sessionRepo.upsert(sessionKey, messages, totalRounds);
  }
}

/** 记忆的加载与自动召回 */
@Injectable()
export class MemoryHandler {
  constructor(private readonly memoryRepo: AgentMemoryRepository) {}

  /** 加载 core memories（type=user），始终全文注入 */
  async loadCore(): Promise<AgentMemory[]> {
    return this.memoryRepo.findByTypes(['user']);
  }

  /** 加载 memory index（type=project），只注入标题 */
  async loadIndex(): Promise<AgentMemory[]> {
    return this.memoryRepo.findByTypes(['project']);
  }

  /** 根据文档标题自动召回相关 project 记忆 */
  async autoRecall(documentTitle?: string): Promise<AgentMemory[]> {
    if (!documentTitle) return [];
    // v1：文档标题分词 → 匹配 project 记忆的 title
    const allProjects = await this.memoryRepo.findByTypes(['project']);
    return allProjects.filter(m =>
      documentTitle.split(/\s+/).some(word => m.title.includes(word))
    );
  }
}

/** system prompt 构建 */
@Injectable()
export class PromptHandler {
  build(params: BuildPromptParams): string {
    // 组装 XML 分节：role + memory_protocol + core_memories
    // + memory_index + conversation_summary + document_portrait + instructions
  }
}

/** 工具集组装 */
@Injectable()
export class ToolAssembler {
  constructor(
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly memoryRepo: AgentMemoryRepository,
  ) {}

  assemble(entryContext: EntryContext): Record<string, Tool> {
    // 工厂函数创建工具，闭包注入 service + 上下文
    // 返回 { search_content, read_document_content, get_current_draft, ... }
  }
}
```

### 编排层

AgentLifecycle 只做编排，不含业务逻辑。它组合 handler 的调用顺序。

```typescript
@Injectable()
export class AgentLifecycle {
  constructor(
    private readonly session: SessionHandler,
    private readonly memory: MemoryHandler,
    private readonly prompt: PromptHandler,
    private readonly tools: ToolAssembler,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * ① SessionLoad（同步流水线）
   * 触发：GET /agent/sessions/:key
   */
  async onSessionLoad(sessionKey: string, documentTitle?: string) {
    // 1. 加载 session
    const sessionData = await this.session.load(sessionKey);

    // 2. 自动 recall（失败不阻塞）
    let relatedMemories: AgentMemory[] = [];
    try {
      relatedMemories = await this.memory.autoRecall(documentTitle);
    } catch (err) {
      // recall 失败 → 降级为空，不影响 session 加载
      Logger.warn('Auto-recall failed', err);
    }

    return { sessionKey, ...sessionData, relatedMemories };
  }

  /**
   * ③ BeforeChat（同步流水线）
   * 触发：POST /agent/chat，LLM 调用之前
   */
  async onBeforeChat(dto: AgentChatDto, aiConfig: AiConfig) {
    // 1. 并行加载 core memories 和 memory index
    const [coreMemories, indexMemories] = await Promise.all([
      this.memory.loadCore(),
      this.memory.loadIndex(),
    ]);

    // 2. 构建 system prompt
    const systemPrompt = this.prompt.build({
      coreMemories,
      indexMemories,
      sessionSummary: dto.sessionSummary,
      relatedMemories: dto.relatedMemories,
      document: dto.entryContext.document,
      selectedText: dto.entryContext.selectedText,
      customSystemPrompt: aiConfig.aiSystemPrompt,
    });

    // 3. 组装工具集
    const tools = this.tools.assemble(dto.entryContext);

    // 4. 转换消息格式
    const modelMessages = await convertToModelMessages(dto.messages);

    return { systemPrompt, tools, modelMessages };
  }

  /**
   * ⑥ AfterChat（异步事件）
   * 触发：PUT /agent/sessions/:key
   */
  async onAfterChat(sessionKey: string, messages: Record<string, unknown>[]) {
    // 1. 同步：保存 session（必须完成）
    await this.session.save(sessionKey, messages);

    // 2. 异步：emit 事件，不阻塞响应
    this.eventEmitter.emit('agent.afterChat', { sessionKey, messages });
  }
}
```

### 异步事件监听

用 `@nestjs/event-emitter`，完全解耦。加新行为只需加一个 listener 类。

```typescript
/** Compaction 监听：检查是否需要压缩 + 提取记忆 */
@Injectable()
export class CompactionListener {
  constructor(private readonly compactionService: CompactionService) {}

  @OnEvent('agent.afterChat', { async: true })
  async handleAfterChat(payload: { sessionKey: string; messages: Record<string, unknown>[] }) {
    await this.compactionService.compactIfNeeded(payload.sessionKey);
  }
}

/** AfterToolUse 监听：日志（v1），未来可加记忆提取 */
@Injectable()
export class ToolUseListener {
  private readonly logger = new Logger(ToolUseListener.name);

  @OnEvent('agent.afterToolUse')
  handleToolUse(payload: { stepNumber: number; toolCalls: ToolCallInfo[] }) {
    if (payload.toolCalls.length > 0) {
      this.logger.log(
        `Step ${payload.stepNumber}: ${payload.toolCalls.map(t => t.toolName).join(', ')}`,
      );
    }
  }
}

// 未来加新行为，比如"每次对话后统计 token 用量"：
// 只需新建一个 listener，不改任何现有代码
@Injectable()
export class TokenUsageListener {
  @OnEvent('agent.afterChat', { async: true })
  async handleAfterChat(payload: { sessionKey: string }) {
    // 统计 token 用量...
  }
}
```

### Controller 调用

controller 变得极简——每个端点就是调一下 lifecycle 方法：

```typescript
@Controller()
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly lifecycle: AgentLifecycle,
  ) {}

  @RawResponse()
  @Post('agent/chat')
  async chat(@Body() dto: AgentChatDto, @Res() reply: FastifyReply, @Req() req: FastifyRequest) {
    const abortController = new AbortController();
    req.raw.on('close', () => abortController.abort());

    // BeforeChat hook
    const aiConfig = await this.systemConfigService.getAiConfig(dto.tier ?? 'standard');
    const { systemPrompt, tools, modelMessages } = await this.lifecycle.onBeforeChat(dto, aiConfig);

    // LLM 调用
    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
      abortSignal: abortController.signal,
      onStepFinish: ({ stepNumber, toolCalls }) => {
        // AfterToolUse 事件
        this.lifecycle.eventEmitter.emit('agent.afterToolUse', { stepNumber, toolCalls });
      },
    });

    return reply.send(result.toUIMessageStreamResponse());
  }

  @Get('agent/sessions/:key')
  async getSession(@Param('key') key: string, @Query('title') title?: string) {
    return this.lifecycle.onSessionLoad(key, title);
  }

  @Put('agent/sessions/:key')
  async saveSession(@Param('key') key: string, @Body('messages') messages: Record<string, unknown>[] = []) {
    await this.lifecycle.onAfterChat(key, messages);
    return { ok: true };
  }

  @Delete('agent/sessions/:key')
  async deleteSession(@Param('key') key: string) {
    await this.sessionRepo.deleteByKey(key);
    return { ok: true };
  }
}
```

---

## Agent 生命周期全景

```
用户打开草稿编辑器
  │
  ▼
① SessionLoad（同步流水线）
  │  SessionHandler.load() → 加载 messages + summary
  │  MemoryHandler.autoRecall() → 匹配相关 project 记忆
  │  → 返回给前端
  │
  ▼
  前端恢复对话，存 summary 和 relatedMemories 到 ref
  │
  ▼
② 用户发消息
  │
  ▼
③ BeforeChat（同步流水线）
  │  MemoryHandler.loadCore() → type=user 全文
  │  MemoryHandler.loadIndex() → type=project 标题
  │  PromptHandler.build() → 组装 system prompt
  │  ToolAssembler.assemble() → 组装工具集
  │  → 交给 streamText()
  │
  ▼
④ LLM 推理（ReAct 循环，最多 10 步）
  │  ├─ tool call 完成 → emit 'agent.afterToolUse'
  │  │   └─ ToolUseListener：日志
  │  └─ 最终 text → SSE 流式返回前端
  │
  ▼
⑤ AI 回复完成
  │
  ▼
⑥ AfterChat（同步保存 + 异步事件）
  │  SessionHandler.save() → 保存 messages（同步，必须完成）
  │  emit 'agent.afterChat' → 异步，不阻塞
  │    └─ CompactionListener：totalRounds ≥ 16？→ 压缩 + 提取记忆
  │
  ▼
  用户继续对话... 回到 ②
```

---

## Module 注册

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),  // ★ 启用事件系统
    TypegooseModule.forFeature([AgentMemory, AgentSession]),
    ContentModule,
    WorkspaceModule,
    SettingsModule,
  ],
  controllers: [AgentController],
  providers: [
    // Handler 层
    SessionHandler,
    MemoryHandler,
    PromptHandler,
    ToolAssembler,

    // 编排层
    AgentLifecycle,

    // 异步监听
    CompactionListener,
    ToolUseListener,

    // 底层服务
    AgentService,
    AgentMemoryRepository,
    AgentSessionRepository,
    CompactionService,
  ],
})
export class AgentModule {}
```

---

## 扩展性示例

### 加一个新的异步行为

需求："每次 AI 回复后，检查用户是否表达了不满，记录到日志"

```typescript
// 新建文件，注册到 module 的 providers 里，完事
@Injectable()
export class SentimentListener {
  @OnEvent('agent.afterChat', { async: true })
  async handle(payload: { sessionKey: string; messages: Record<string, unknown>[] }) {
    // 分析最后一条用户消息的情绪...
  }
}
```

**不改 lifecycle、不改 controller、不改任何现有代码。**

### 新入口的 agent（比如相册管理）

```typescript
// 继承或组合不同的 handler
@Injectable()
export class GalleryAgentLifecycle {
  constructor(
    private readonly session: SessionHandler,     // 复用
    private readonly memory: MemoryHandler,       // 复用
    private readonly prompt: GalleryPromptHandler, // 不同的 prompt 构建
    private readonly tools: GalleryToolAssembler,  // 不同的工具集
  ) {}
}
```

**handler 层可复用，prompt 和 tools 按入口定制。**
