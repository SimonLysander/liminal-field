/**
 * AgentService — Agent 对话的核心 LLM 调用层。
 *
 * 职责（精简后）：
 * 1. 按 agentKey 加载 AgentEntryConfig（tier / systemPrompt / tools 白名单）
 * 2. 读取 AI 配置（baseUrl / apiKey / model），tier 优先级：前端传入 > 入口配置 > standard
 * 3. 通过 AgentLifecycle.onBeforeChat 获取 systemPrompt 和 tools
 * 4. 由 Pi Agent 驱动 OpenAI Responses 工具循环
 *
 * 记忆加载、system prompt 构建、工具组装全部委托给 AgentLifecycle，
 * 本服务只负责 LLM 调用本身。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  consumeStream,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { randomUUID } from 'node:crypto';
import { SystemConfigService } from '../settings/system-config.service';
import { AgentLifecycle } from './lifecycle/agent-lifecycle.service';
import { AgentSessionRepository } from './session/agent-session.repository';
import { PendingWriteRepository } from './approval/pending-write.repository';
import { approvalResultsFeedback } from '../../prompts/feedback';
import { GalleryViewService } from '../workspace/gallery-view.service';
import { splitForCompaction } from './context/compaction-split';
import { sanitizeAbortedToolCalls } from './context/sanitize-aborted-tool-calls';
import { pruneFailedToolTurns } from './context/prune-failed-tool-turns';
import { dropContentlessMessages } from './context/drop-contentless-messages';
import { stripNullFields } from './context/strip-null-fields';
import type { AgentChatDto } from './dto/agent-chat.dto';
import { PiModelRuntimeService } from '../../infrastructure/ai/pi-model-runtime.service';
import { adaptToolsForPi } from '../../infrastructure/ai/pi-tool.adapter';
import {
  readUserText,
  uiMessagesToPi,
} from '../../infrastructure/ai/pi-message.adapter';
import { pipePiAgentToUi } from '../../infrastructure/ai/pi-ui-stream.adapter';
import { AgentRunManager } from './run/agent-run-manager.service';
import {
  isPiToolResultInvalid,
  readPiToolResultText,
} from '../../infrastructure/ai/pi-tool-result';
import { hasRepeatedInvalidToolNames } from './agent.utils';
import { AI_RUNTIME_LIMITS } from '../../infrastructure/ai/ai-runtime-limits';

/** 喂模型最近原文的 token 占比(与 compaction 同标准:超 60% 才裁,保留到 30% 额度) */
const TRIGGER_RATIO = 0.6;
const KEEP_RATIO = 0.3;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly lifecycle: AgentLifecycle,
    private readonly sessionRepo: AgentSessionRepository,
    private readonly galleryView: GalleryViewService,
    private readonly pendingWriteRepo: PendingWriteRepository,
    private readonly piRuntime: PiModelRuntimeService,
    private readonly runManager: AgentRunManager,
  ) {}

  // 返回 Web Response(toUIMessageStreamResponse 产物),controller 直接 reply.send。
  // 持久化、consumeStream 都收在本方法内,controller 不碰业务。
  async chat(dto: AgentChatDto): Promise<Response> {
    // 1. 读取 agent 入口配置（AgentEntryConfig），获取 tier / systemPrompt / tools 白名单
    const agentConfig = dto.agentKey
      ? await this.systemConfigService.getAgentConfig(dto.agentKey)
      : null;

    // 1b. 检查 enabled 状态
    if (agentConfig && !agentConfig.enabled) {
      throw new BadRequestException(`Agent "${dto.agentKey}" 已禁用`);
    }

    // 2. 读取 AI 配置，tier 优先级：前端传入 > 入口配置 > 默认 standard
    //    例外:vision 入口(画廊图说写手)天然需要多模态模型,不容前端 tier 开关
    //    (默认 'standard')把它降级成无视觉的文本模型——vision 入口恒用 vision。
    const tier =
      agentConfig?.tier === 'vision'
        ? 'vision'
        : (dto.tier ?? agentConfig?.tier ?? 'standard');
    // 按 tier 取该 agent 对应 slot 的 providerId(2026-05-31,#143 重构):
    // flash/standard/think/vision 4 个 slot 各自独立绑,任一空 → 回退到
    // agentConfig.providerId(全 tier 共用)→ 再回退到全局 activeAiProviderId。
    const tierProviderId =
      tier === 'flash'
        ? agentConfig?.flashProviderId
        : tier === 'think'
          ? agentConfig?.thinkProviderId
          : tier === 'vision'
            ? agentConfig?.visionProviderId
            : agentConfig?.standardProviderId;
    const aiConfig = await this.systemConfigService.getAiConfig(
      tier,
      tierProviderId || agentConfig?.providerId,
    );
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      throw new BadRequestException(
        'AI 配置不完整，请先在设置页配置 API 地址、密钥和模型',
      );
    }

    // 3. 创建 Pi Responses runtime。所有 provider 均通过 /responses，不再走 chat/completions。
    const runtime = await this.piRuntime.createRuntime(aiConfig, tier);

    const incoming = dto.message as Record<string, unknown> | undefined;
    if (!incoming) {
      throw new BadRequestException('缺少 message');
    }
    const sessionKey = dto.entryContext.sessionKey ?? '';
    // 历史只查一次：完整有界窗口供主模型使用，末尾 8 条同时给 sub-agent 理解委派来由。
    const previousPromise = sessionKey
      ? this.sessionRepo.getRecentByBudget(
          sessionKey,
          aiConfig.contextWindow,
          TRIGGER_RATIO,
        )
      : Promise.resolve([]);

    // 4. BeforeChat 钩子：并行加载记忆 + 构建 systemPrompt + 组装 tools
    //    将入口配置的 systemPrompt 和 tools 白名单一并传入
    const { systemPrompt, tools } = await this.lifecycle.onBeforeChat(
      dto,
      {
        aiSystemPrompt: aiConfig.aiSystemPrompt,
        entrySystemPrompt: agentConfig?.systemPrompt,
        allowedTools: agentConfig?.tools,
        tier,
        // agent skills:启用的 Skill _id 列表透传给 lifecycle,prompt 注入 <available_skills> +
        //   tool.assembler 挂 Skill 工具(配置驱动,空列表 → 两者都不动)
        enabledSkillIds: agentConfig?.enabledSkillIds,
      },
      previousPromise.then((messages) => messages.slice(-8)),
    );

    // 5. 组装喂模型的"最近原文"。后端权威上下文:历史从 agent_sessions 读(按 token
    //    有界),不再信任前端全量上传;本轮新消息走单条 dto.message。
    // ratio 用 TRIGGER_RATIO:读取量 ≥ 喂模型量,保证 splitForCompaction 有料可切;
    // 更早的对话精华已在 session 记忆里(随 system prompt 注入),不重复读。

    // HITL 审批结果回灌:上次门禁写工具被批准/拒绝(带外 REST,模型当时不知道),
    // 这一轮把结果作为带外事实追加进 system,只回灌一次(标 notifiedToModel)。
    // 放 system 而非塞进消息流:瞬态、不持久化,且 system 正是「带外事实」的归属。
    let approvalFeedback = '';
    if (sessionKey) {
      const resolved =
        await this.pendingWriteRepo.findResolvedUnnotified(sessionKey);
      if (resolved.length > 0) {
        // 模型文案单一真源在 prompts/feedback.ts(短指令片段→ts)
        approvalFeedback = approvalResultsFeedback(resolved);
        await this.pendingWriteRepo.markNotified(
          resolved.map((r) => String(r._id)),
        );
      }
    }

    const previous = await previousPromise;
    const combined = [...previous, incoming] as Record<string, unknown>[];

    //    sanitizeAbortedToolCalls:先给上轮中止留下的半截 tool_call 补齐协议；
    //    pruneFailedToolTurns:再从本次模型上下文中删除参数错误/中止调用，避免模型模仿
    //    旧的空参数或坏 JSON。原始消息仍保存在 DB，前端展示与排障不受影响。
    //    stripNullFields:剔除 DB 存量消息里的显式 null 字段(metadata/providerMetadata…),
    //    否则 convertToModelMessages 的 UIMessage schema(.optional 拒 null)会拒,导致多轮 turn2 崩。
    //    dropContentlessMessages:丢弃空 assistant 毒消息(parts:[] / 仅 reasoning)。
    //    splitForCompaction:与 compaction 同一套 token 切分,保证"喂的最近原文"口径一致。
    const recent = dropContentlessMessages(
      pruneFailedToolTurns(sanitizeAbortedToolCalls(stripNullFields(combined))),
    );
    const { toKeep } = splitForCompaction(recent, {
      window: aiConfig.contextWindow,
      // 固定开销已并入 system/记忆,此处只关心"最近原文"额度,fixed 给 0 让 keepRatio 满额生效
      fixedTokens: 0,
      triggerRatio: TRIGGER_RATIO,
      keepRatio: KEEP_RATIO,
    });
    // combined 的最后一条固定是本轮 incoming；Pi initialState 只放历史，当前消息
    // 交给 prompt()，否则 Responses 会看到同一条用户消息两次。
    const historyUi = toKeep.slice(0, -1);
    const history = uiMessagesToPi(historyUi, runtime.model);
    const userText = readUserText(incoming);
    if (!userText.trim()) {
      throw new BadRequestException('消息正文为空');
    }
    // 无持久化会话的临时请求不得共用同一个运行锁，否则两个匿名页面会互相取消。
    const runKey = sessionKey || `ephemeral:${randomUUID()}`;

    // 画廊场景:模型调 view_photos 后,把它点名的照片 base64 附在本次工具结果中。
    // 图片只进入当前 Pi transcript，不写入 UIMessage/agent_sessions；下轮需要查看时再次调用工具。
    const gallery = dto.entryContext.gallery;
    const galleryImageCache = new Map<
      string,
      { b64: string; mediaType: string }
    >();

    // 6. Pi 负责 Responses 工具循环；Vercel AI SDK 仅保留为前端 UI stream 协议。
    let turns = 0;
    const invalidToolNamesByTurn: Array<ReadonlySet<string>> = [];
    const agent = await this.piRuntime.createAgent({
      initialState: {
        systemPrompt: systemPrompt + approvalFeedback,
        model: runtime.model,
        tools: adaptToolsForPi(tools),
        messages: history,
        thinkingLevel: tier === 'think' ? 'high' : 'off',
      },
      streamFn: runtime.streamFn,
      sessionId: sessionKey || undefined,
      toolExecution: 'parallel',
      shouldStopAfterTurn: () =>
        turns >= AI_RUNTIME_LIMITS.mainAgentMaxTurns ||
        hasRepeatedInvalidToolNames(invalidToolNamesByTurn, 2),
      afterToolCall: gallery
        ? async ({ toolCall, args, result }) => {
            if (toolCall.name !== 'view_photos') return undefined;
            const fileNames = Array.isArray(
              (args as { fileNames?: unknown }).fileNames,
            )
              ? (args as { fileNames: unknown[] }).fileNames.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
            const images: Array<
              | { type: 'text'; text: string }
              | { type: 'image'; data: string; mimeType: string }
            > = [];
            for (const fileName of fileNames) {
              if (!gallery.photos.some((photo) => photo.fileName === fileName))
                continue;
              let image = galleryImageCache.get(fileName);
              if (!image) {
                try {
                  const loaded = await this.galleryView.readPhotoForVision(
                    gallery.contentItemId,
                    fileName,
                  );
                  image = {
                    b64: loaded.buffer.toString('base64'),
                    mediaType: loaded.mediaType,
                  };
                  galleryImageCache.set(fileName, image);
                } catch (error) {
                  this.logger.warn(
                    `画廊图片读取失败 fileName=${fileName} reason=${error instanceof Error ? error.message : String(error)}`,
                  );
                  continue;
                }
              }
              images.push({ type: 'text', text: `[${fileName}]` });
              images.push({
                type: 'image',
                data: image.b64,
                mimeType: image.mediaType,
              });
            }
            return images.length > 0
              ? { content: [...result.content, ...images] }
              : undefined;
          }
        : undefined,
    });
    const runId = this.runManager.begin(runKey, agent);
    const unsubscribeObservability = agent.subscribe((event) => {
      if (event.type === 'agent_end') {
        this.logger.log(
          `Agent finished sessionKey=${sessionKey || '-'} runId=${runId} turns=${turns}`,
        );
        return;
      }
      if (event.type !== 'turn_end') return;

      turns += 1;
      invalidToolNamesByTurn.push(
        new Set(
          event.toolResults
            .filter(isPiToolResultInvalid)
            .map((result) => result.toolName),
        ),
      );
      if (invalidToolNamesByTurn.length > 2) invalidToolNamesByTurn.shift();
      if (turns >= AI_RUNTIME_LIMITS.mainAgentMaxTurns) {
        this.logger.warn(
          `Agent reached safety turn limit sessionKey=${sessionKey || '-'} runId=${runId} turns=${turns}`,
        );
      }
      if (
        event.message.role === 'assistant' &&
        event.message.stopReason === 'length'
      ) {
        this.logger.warn(
          `Agent response reached token limit sessionKey=${sessionKey || '-'} runId=${runId} turn=${turns}`,
        );
      }
      const toolCalls = event.toolResults.map((result) => ({
        toolName: result.toolName,
      }));
      if (toolCalls.length > 0) {
        this.lifecycle.emitAfterToolUse(turns, toolCalls);
      }
      for (const result of event.toolResults) {
        if (!result.isError) continue;
        this.logger.warn(
          `Step ${turns}: 工具执行失败 tool=${result.toolName} toolCallId=${result.toolCallId} reason=${readPiToolResultText(result).slice(0, 240)}`,
        );
      }
      if (event.message.role === 'assistant') {
        this.logger.debug(
          `Step ${turns}: model=${event.message.model} input=${event.message.usage.input} output=${event.message.usage.output} tools=${toolCalls.length}`,
        );
      }
    });

    // 后端权威持久化:流结束时把本轮增量 append 进 agent_sessions(不再靠前端 PUT)。
    // onFinish 的 messages = originalMessages(=combined) + 本轮新生成消息;
    // slice(previousCount) 恰好取到 incoming(user) + assistant/tool 消息,映射既有 append-only。
    const agentInstanceKey = dto.entryContext.agentInstanceKey;
    const previousCount = previous.length;
    const stream = createUIMessageStream({
      originalMessages: combined as never,
      generateId: createIdGenerator({ prefix: 'msg', size: 16 }),
      execute: async ({ writer }) => {
        const unsubscribe = pipePiAgentToUi(agent, writer, this.logger);
        try {
          await agent.prompt(userText);
        } finally {
          unsubscribe();
          unsubscribeObservability();
          this.runManager.finish(runKey, runId);
        }
      },
      onError: (error) => {
        this.logger.error(
          `Pi Agent 流失败 sessionKey=${sessionKey} runId=${runId}`,
          error instanceof Error ? error.stack : String(error),
        );
        return error instanceof Error ? error.message : '模型响应失败';
      },
      onFinish: ({ messages }) => {
        // 本轮增量(incoming user + 本轮 assistant/tool)。stripNullFields:持久化前剔除
        // AI SDK 给的显式 null 字段,保持 DB 干净(否则下轮读出会崩,见 strip-null-fields)。
        // dropContentlessMessages:丢弃空 assistant 毒消息,防模型空回复进库毒死后续轮。
        const delta = dropContentlessMessages(
          stripNullFields(
            (messages as unknown as Record<string, unknown>[]).slice(
              previousCount,
            ),
          ),
        );
        if (delta.length === 0) return;
        void this.lifecycle
          .onAfterChat(
            sessionKey,
            delta,
            aiConfig.contextWindow,
            agentInstanceKey,
          )
          .catch((err: unknown) =>
            this.logger.error(
              `onAfterChat 调用异常 sessionKey=${sessionKey}`,
              err instanceof Error ? err.stack : String(err),
            ),
          );
      },
    });
    // 服务端保留一个消费分支：浏览器因切后台或网络切换断开时，Pi 仍能完成当前轮，
    // handleUIMessageStreamFinish 也能拿到完整消息并触发 onFinish 持久化。
    // 用户显式点击停止时由 AgentRunManager.abort() 中止两个分支共享的上游运行。
    const [clientStream, persistenceStream] = stream.tee();
    void consumeStream({
      stream: persistenceStream,
      onError: (error) =>
        this.logger.error(
          `Pi Agent 服务端流消费失败 sessionKey=${sessionKey} runId=${runId}`,
          error instanceof Error ? error.stack : String(error),
        ),
    });
    return createUIMessageStreamResponse({
      stream: clientStream,
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Agent-Run-Id': runId,
      },
    });
  }
}
