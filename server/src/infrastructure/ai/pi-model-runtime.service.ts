import { Injectable, Logger } from '@nestjs/common';
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type {
  Agent,
  AgentOptions,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import { AI_RUNTIME_LIMITS, resolveModelMaxTokens } from './ai-runtime-limits';

export interface PiModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
}

export interface PiModelRuntime {
  model: Model<'openai-responses'>;
  streamFn: StreamFn;
}

export interface PiCompleteTextOptions {
  system?: string;
  prompt?: string;
  messages?: Context['messages'];
  maxTokens?: number;
  signal?: AbortSignal;
  reasoning?: SimpleStreamOptions['reasoning'];
}

export interface PiCompleteTextResult {
  text: string;
  finishReason: AssistantMessage['stopReason'];
  message: AssistantMessage;
}

export interface PiStreamTextOptions extends PiCompleteTextOptions {
  onError?: (error: Error) => void;
}

/**
 * Pi/OpenAI Responses 的单一运行时入口。
 *
 * Pi 是纯 ESM 包，而 Nest 服务仍由 SWC 编译为 CommonJS。这里通过保留原生
 * import() 建立唯一的 ESM 边界，业务模块不直接加载 Pi，也不各自处理鉴权、
 * 模型元数据和 Responses endpoint。
 */
@Injectable()
export class PiModelRuntimeService {
  private readonly logger = new Logger(PiModelRuntimeService.name);

  async createRuntime(
    config: PiModelConfig,
    tier: string = 'standard',
  ): Promise<PiModelRuntime> {
    this.assertConfig(config);
    const { openAIResponsesApi } =
      await import('@earendil-works/pi-ai/api/openai-responses.lazy');
    const api = openAIResponsesApi();
    const provider = `configured-${this.safeProviderId(config.baseUrl)}`;
    const model: Model<'openai-responses'> = {
      id: config.model,
      name: config.model,
      api: 'openai-responses',
      provider,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      reasoning: tier === 'think',
      input: tier === 'vision' ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.contextWindow,
      maxTokens: resolveModelMaxTokens(config.contextWindow),
    };

    const streamFn: StreamFn = (runtimeModel, context, options = {}) =>
      api.streamSimple(runtimeModel, context, {
        ...options,
        apiKey: config.apiKey,
        // 供应商级重试留在 Pi/OpenAI SDK 内完成；上层不再整轮盲重跑工具。
        timeoutMs:
          options.timeoutMs ?? AI_RUNTIME_LIMITS.providerRequestTimeoutMs,
        maxRetries: options.maxRetries ?? AI_RUNTIME_LIMITS.providerMaxRetries,
        maxRetryDelayMs:
          options.maxRetryDelayMs ?? AI_RUNTIME_LIMITS.providerMaxRetryDelayMs,
      });

    return { model, streamFn };
  }

  /** Pi Agent 的唯一构造入口，使业务层不感知纯 ESM 包的加载方式。 */
  async createAgent(options: AgentOptions): Promise<Agent> {
    const { Agent: PiAgent } = await import('@earendil-works/pi-agent-core');
    return new PiAgent(options);
  }

  async completeText(
    config: PiModelConfig,
    options: PiCompleteTextOptions,
    tier: string = 'standard',
  ): Promise<PiCompleteTextResult> {
    const runtime = await this.createRuntime(config, tier);
    const messages: Context['messages'] = options.messages ?? [
      {
        role: 'user',
        content: options.prompt ?? '',
        timestamp: Date.now(),
      },
    ];
    const startedAt = Date.now();
    const eventStream = await runtime.streamFn(
      runtime.model,
      { systemPrompt: options.system, messages },
      {
        apiKey: config.apiKey,
        signal: options.signal,
        maxTokens: options.maxTokens,
        reasoning: options.reasoning,
      },
    );
    const message = await eventStream.result();
    if (message.stopReason === 'error' || message.stopReason === 'aborted') {
      throw new Error(message.errorMessage || `模型调用${message.stopReason}`);
    }
    if (message.stopReason === 'length') {
      this.logger.warn(
        `Responses output reached token limit model=${config.model} maxTokens=${options.maxTokens ?? runtime.model.maxTokens}`,
      );
    }
    const text = message.content
      .filter(
        (part): part is { type: 'text'; text: string } => part.type === 'text',
      )
      .map((part) => part.text)
      .join('');
    this.logger.debug(
      `Responses complete model=${config.model} durationMs=${Date.now() - startedAt} input=${message.usage.input} output=${message.usage.output}`,
    );
    return { text, finishReason: message.stopReason, message };
  }

  async streamText(
    config: PiModelConfig,
    options: PiStreamTextOptions,
    tier: string = 'standard',
  ): Promise<ReadableStream<Uint8Array>> {
    const runtime = await this.createRuntime(config, tier);
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }
    const source = runtime.streamFn(
      runtime.model,
      {
        systemPrompt: options.system,
        messages: options.messages ?? [
          {
            role: 'user',
            content: options.prompt ?? '',
            timestamp: Date.now(),
          },
        ],
      },
      {
        signal: controller.signal,
        apiKey: config.apiKey,
        maxTokens: options.maxTokens,
        reasoning: options.reasoning,
      },
    );
    const eventStream = await Promise.resolve(source);
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
      async start(streamController) {
        try {
          for await (const event of eventStream) {
            if (event.type === 'text_delta') {
              streamController.enqueue(encoder.encode(event.delta));
            } else if (event.type === 'error') {
              throw new Error(event.error.errorMessage || '模型响应失败');
            }
          }
          streamController.close();
        } catch (error) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          options.onError?.(normalized);
          streamController.error(normalized);
        } finally {
          options.signal?.removeEventListener('abort', onExternalAbort);
        }
      },
      cancel(reason) {
        controller.abort(reason);
        options.signal?.removeEventListener('abort', onExternalAbort);
      },
    });
  }

  private assertConfig(config: PiModelConfig): void {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new Error('AI 配置不完整');
    }
    if (!Number.isFinite(config.contextWindow) || config.contextWindow <= 0) {
      throw new Error('AI contextWindow 必须是正数');
    }
  }

  private safeProviderId(baseUrl: string): string {
    try {
      return new URL(baseUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');
    } catch {
      return 'custom';
    }
  }
}
