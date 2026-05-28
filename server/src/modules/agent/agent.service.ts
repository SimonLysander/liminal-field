/**
 * AgentService — Agent 对话的核心 LLM 调用层。
 *
 * 职责（精简后）：
 * 1. 按 agentKey 加载 AgentEntryConfig（tier / systemPrompt / tools 白名单）
 * 2. 读取 AI 配置（baseUrl / apiKey / model），tier 优先级：前端传入 > 入口配置 > standard
 * 3. 通过 AgentLifecycle.onBeforeChat 获取 systemPrompt 和 tools
 * 4. 调用 Vercel AI SDK 的 streamText，内置 ReAct 循环（最多 10 步）
 *
 * 记忆加载、system prompt 构建、工具组装全部委托给 AgentLifecycle，
 * 本服务只负责 LLM 调用本身。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  convertToModelMessages,
  createIdGenerator,
  stepCountIs,
  streamText,
} from 'ai';
import { makeRepairToolCall } from './agent.utils';
import { SystemConfigService } from '../settings/system-config.service';
import { AgentLifecycle } from './lifecycle/agent-lifecycle.service';
import { AgentSessionRepository } from './session/agent-session.repository';
import { splitForCompaction } from './context/compaction-split';
import { sanitizeAbortedToolCalls } from './context/sanitize-aborted-tool-calls';
import { dropContentlessMessages } from './context/drop-contentless-messages';
import { stripNullFields } from './context/strip-null-fields';
import type { AgentChatDto } from './dto/agent-chat.dto';

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
    const tier = dto.tier ?? agentConfig?.tier ?? 'standard';
    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      throw new BadRequestException(
        'AI 配置不完整，请先在设置页配置 API 地址、密钥和模型',
      );
    }

    // 3. 创建兼容 OpenAI 格式的 LLM provider（支持任意 openai-compatible 接口）
    const provider = createOpenAICompatible({
      name: 'custom-llm',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    const model = provider.chatModel(aiConfig.model);

    // 4. BeforeChat 钩子：并行加载记忆 + 构建 systemPrompt + 组装 tools
    //    将入口配置的 systemPrompt 和 tools 白名单一并传入
    const { systemPrompt, tools } = await this.lifecycle.onBeforeChat(dto, {
      aiSystemPrompt: aiConfig.aiSystemPrompt,
      entrySystemPrompt: agentConfig?.systemPrompt,
      allowedTools: agentConfig?.tools,
      tier,
    });

    // 5. 组装喂模型的"最近原文"。后端权威上下文:历史从 agent_sessions 读(按 token
    //    有界),不再信任前端全量上传;本轮新消息走单条 dto.message。
    const incoming = dto.message as Record<string, unknown> | undefined;
    if (!incoming) {
      throw new BadRequestException('缺少 message');
    }

    // ratio 用 TRIGGER_RATIO:读取量 ≥ 喂模型量,保证 splitForCompaction 有料可切;
    // 更早的对话精华已在 session 记忆里(随 system prompt 注入),不重复读。
    const sessionKey = dto.entryContext.sessionKey ?? '';
    const previous = sessionKey
      ? await this.sessionRepo.getRecentByBudget(
          sessionKey,
          aiConfig.contextWindow,
          TRIGGER_RATIO,
        )
      : [];
    const combined = [...previous, incoming] as Record<string, unknown>[];

    //    sanitizeAbortedToolCalls:上轮按「停止」时半截的 tool_call 会留在 DB 历史里,
    //    如不处理 convertToModelMessages 会抛 AI_MissingToolResultsError(每个 tool_call
    //    必须配对 tool_result)。先消毒成 output-error 占位,让协议合法 + 给模型留「上次中止了」上下文。
    //    stripNullFields:剔除 DB 存量消息里的显式 null 字段(metadata/providerMetadata…),
    //    否则 convertToModelMessages 的 UIMessage schema(.optional 拒 null)会拒,导致多轮 turn2 崩。
    //    dropContentlessMessages:丢弃空 assistant 毒消息(parts:[] / 仅 reasoning)。
    //    splitForCompaction:与 compaction 同一套 token 切分,保证"喂的最近原文"口径一致。
    const recent = dropContentlessMessages(
      sanitizeAbortedToolCalls(stripNullFields(combined)),
    );
    const { toKeep } = splitForCompaction(recent, {
      window: aiConfig.contextWindow,
      // 固定开销已并入 system/记忆,此处只关心"最近原文"额度,fixed 给 0 让 keepRatio 满额生效
      fixedTokens: 0,
      triggerRatio: TRIGGER_RATIO,
      keepRatio: KEEP_RATIO,
    });
    const modelMessages = await convertToModelMessages(
      toKeep as Parameters<typeof convertToModelMessages>[0],
    );

    // 6. 调用 streamText：AI SDK 内置 ReAct 循环，stopWhen 限制最多 10 步防止无限循环
    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
      // 工具调用烂 JSON 时自动 re-ask 修复,不让整轮崩(provider 偶发,见 agent.utils)
      experimental_repairToolCall: makeRepairToolCall(model),
      experimental_telemetry: { isEnabled: true },
      onStepFinish: ({ stepNumber, toolCalls, usage }) => {
        // 通过 lifecycle 发射工具调用事件，解耦日志记录逻辑
        if (toolCalls.length > 0) {
          this.lifecycle.emitAfterToolUse(
            stepNumber,
            toolCalls.map((t) => ({ toolName: t.toolName })),
          );
        }
        if (usage) {
          this.logger.debug(
            `Step ${stepNumber}: tokens=${usage.totalTokens ?? '?'}`,
          );
        }
      },
      onFinish: ({ usage, steps }) => {
        this.logger.log(
          `Agent finished: ${steps.length} steps, ${usage?.totalTokens ?? '?'} total tokens`,
        );
      },
    });

    // 后端权威持久化:流结束时把本轮增量 append 进 agent_sessions(不再靠前端 PUT)。
    // onFinish 的 messages = originalMessages(=combined) + 本轮新生成消息;
    // slice(previousCount) 恰好取到 incoming(user) + assistant/tool 消息,映射既有 append-only。
    const agentInstanceKey = dto.entryContext.agentInstanceKey;
    const previousCount = previous.length;
    const response = result.toUIMessageStreamResponse({
      originalMessages: combined as never,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
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
        void this.lifecycle.onAfterChat(
          sessionKey,
          delta,
          aiConfig.contextWindow,
          agentInstanceKey,
        );
      },
    });
    // consumeStream:即使客户端断开/按停,服务端也跑完流 → onFinish 持久化不丢本轮。
    void result.consumeStream();
    return response;
  }
}
