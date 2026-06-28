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
import { PendingWriteRepository } from './approval/pending-write.repository';
import { GalleryViewService } from '../workspace/gallery-view.service';
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
    private readonly galleryView: GalleryViewService,
    private readonly pendingWriteRepo: PendingWriteRepository,
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
      // agent skills:启用的 Skill _id 列表透传给 lifecycle,prompt 注入 <available_skills> +
      //   tool.assembler 挂 Skill 工具(配置驱动,空列表 → 两者都不动)
      enabledSkillIds: agentConfig?.enabledSkillIds,
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

    // HITL 审批结果回灌:上次门禁写工具被批准/拒绝(带外 REST,模型当时不知道),
    // 这一轮把结果作为带外事实追加进 system,只回灌一次(标 notifiedToModel)。
    // 放 system 而非塞进消息流:瞬态、不持久化,且 system 正是「带外事实」的归属。
    let approvalFeedback = '';
    if (sessionKey) {
      const resolved =
        await this.pendingWriteRepo.findResolvedUnnotified(sessionKey);
      if (resolved.length > 0) {
        const lines = resolved.map((r) => {
          const verb =
            r.status === 'approved'
              ? '已获用户批准并写入'
              : '被用户拒绝,未写入';
          return `- ${r.toolName}:${verb}`;
        });
        approvalFeedback = `\n\n<approval_results>\n你之前提议的写操作,用户已裁决:\n${lines.join('\n')}\n据此继续:被批准的视为已落库,无需重复提议;被拒绝的不要假装写了,可问清原因或换思路。\n</approval_results>`;
        await this.pendingWriteRepo.markNotified(
          resolved.map((r) => String(r._id)),
        );
      }
    }

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

    // 画廊场景:模型调 view_photos 后,把它点名的照片 base64 注进后续步的 user message
    // (openai-compatible 不让 tool 返图,GV3 实测;故走 prepareStep 注入)。图不进 agent_sessions
    // (onFinish 持久化的是 toUIMessageStream 的消息,不含此处临时注入),下轮要看再调 view_photos。
    const gallery = dto.entryContext.gallery;
    const galleryImageCache = new Map<
      string,
      { b64: string; mediaType: string }
    >();

    // 6. 调用 streamText：AI SDK 内置 ReAct 循环，stopWhen 限制最多 10 步防止无限循环
    const result = streamText({
      model,
      system: systemPrompt + approvalFeedback,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
      // 流中途错误(provider 在响应头已发出后失败)结构化记录,否则只进 SSE error part、
      // 服务端无日志,违反「不静默失败」纪律,排错只能靠猜。
      onError: ({ error }: { error: unknown }) =>
        this.logger.error(
          'streamText 流错误',
          error instanceof Error ? error.stack : String(error),
        ),
      // 画廊按需注图:只注「刚执行那步」新调的 view_photos 的图——看完那步注一次,之后不每步重发
      // (模型对图的描述已写进上下文,够后续用;要再看它会再调 view_photos → 下一步再注)。省视觉 token、提速。
      prepareStep: gallery
        ? async ({ steps, messages }) => {
            const lastStep = steps[steps.length - 1];
            const fresh: string[] = [];
            for (const call of lastStep?.toolCalls ?? []) {
              if (call.toolName !== 'view_photos') continue;
              const fileNames =
                (call.input as { fileNames?: string[] })?.fileNames ?? [];
              for (const fn of fileNames)
                if (
                  gallery.photos.some((p) => p.fileName === fn) &&
                  !fresh.includes(fn)
                )
                  fresh.push(fn);
            }
            if (fresh.length === 0) return {};
            const imageParts: Array<
              | { type: 'text'; text: string }
              | { type: 'image'; image: string; mediaType: string }
            > = [];
            for (const fn of fresh) {
              let img = galleryImageCache.get(fn);
              if (!img) {
                try {
                  // 严格走 OSS 缩放版(webp,~1280px),不读磁盘、不取原图
                  // (见「agent 工具不读磁盘」原则);模型不需要高清,多图才扛得住。
                  const { buffer, mediaType } =
                    await this.galleryView.readPhotoForVision(
                      gallery.contentItemId,
                      fn,
                    );
                  img = { b64: buffer.toString('base64'), mediaType };
                  galleryImageCache.set(fn, img);
                } catch {
                  continue; // 取不到字节(未上传完/已删)→跳过,不打断本轮
                }
              }
              imageParts.push({ type: 'text', text: `[${fn}]` });
              imageParts.push({
                type: 'image',
                image: img.b64,
                mediaType: img.mediaType,
              });
            }
            if (imageParts.length === 0) return {};
            return {
              messages: [
                ...messages,
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: '你请求查看的照片:' },
                    ...imageParts,
                  ],
                },
              ],
            };
          }
        : undefined,
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
    // consumeStream:客户端断开/按停时也把流消费完,确保 onFinish 触发 → 持久化本轮
    // 「已生成的内容」(可能只是部分回复;若断在出文本前则 assistant 为空,被
    // dropContentlessMessages 丢弃,只留 user)。保证的是不损坏/不留毒,而非完整回复。
    // consumeStream 返回 PromiseLike(无 .catch),用 Promise.resolve 包一层再挂错误日志
    void Promise.resolve(result.consumeStream()).catch((err: unknown) =>
      this.logger.error(
        'consumeStream 失败',
        err instanceof Error ? err.stack : String(err),
      ),
    );
    return response;
  }
}
