/**
 * SubAgentService — 子 agent 执行器。
 *
 * 主 agent 通过 sub_agent 工具委派任务，子 agent 有：
 * - 独立的 context window（不污染主对话）
 * - 自动继承用户目标、近期对话与当前业务场景
 * - 只读工具集（知识库、当前学习内容、网页检索与读取）
 * - 不能 remember / forget / sub_agent（不能写记忆，不能嵌套）
 *
 * 用 Pi Agent + OpenAI Responses 执行，完成后把完整研究报告返回给主 agent。
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SystemConfigService } from '../../settings/system-config.service';
import { ContentService } from '../../content/content.service';
import { NoteViewService } from '../../workspace/note-view.service';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { ExternalCacheRepository } from '../../external-cache/external-cache.repository';
import { createSearchKnowledgeBaseTool } from '../tools/search-content.tool';
import { createListKnowledgeBaseTool } from '../tools/list-content.tool';
import { createReadDocumentContentTool } from '../tools/read-content.tool';
import { createGetCurrentDraftTool } from '../tools/get-current-document.tool';
import { createReadContentTool } from '../tools/read-node-content.tool';
import { createWebSearchTool } from '../tools/web-search.tool';
import { createWebSearchProviderFromEnv } from '../tools/web-search-provider';
import { createWebFetchTool } from '../tools/web-fetch.tool';
import { createWebFetchProviderFromEnv } from '../tools/web-fetch-provider';
import { applyToolDescriptions } from '../tools/apply-tool-descriptions';
import { toolResult } from '../tools/tool-result';
import { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';
import {
  buildSubAgentPrompt,
  type SubAgentParentContext,
} from './sub-agent-context';
import { PiModelRuntimeService } from '../../../infrastructure/ai/pi-model-runtime.service';
import { adaptToolsForPi } from '../../../infrastructure/ai/pi-tool.adapter';
import {
  isPiToolResultInvalid,
  readPiToolOutput,
} from '../../../infrastructure/ai/pi-tool-result';
import { hasRepeatedInvalidToolNames } from '../agent.utils';
import {
  AI_RUNTIME_LIMITS,
  resolveSubAgentSteps,
} from '../../../infrastructure/ai/ai-runtime-limits';

const READ_TOOL_NAMES = new Set([
  'read_document_content',
  'read_content',
  'web_fetch',
]);

@Injectable()
export class SubAgentService {
  private readonly logger = new Logger(SubAgentService.name);

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly eventEmitter: EventEmitter2,
    private readonly promptManager: PromptManagerService,
    private readonly editorDraftRepo: EditorDraftRepository,
    private readonly externalCacheRepo: ExternalCacheRepository,
    private readonly piRuntime: PiModelRuntimeService,
  ) {}

  /**
   * 执行子 agent 任务。
   *
   * @param task 主 agent 指定的研究焦点
   * @param parentContext 自动继承的用户目标、近期对话和业务现场
   * @param maxSteps 最大推理步数；缺省使用统一的宽松研究深度
   * @param tier 模型层级，默认 standard
   */
  async execute(params: {
    task: string;
    parentContext?: SubAgentParentContext;
    maxSteps?: number;
    tier?: string;
    sessionKey?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const {
      task,
      parentContext = {},
      maxSteps: requestedMaxSteps,
      tier = 'standard',
      sessionKey,
      signal,
    } = params;
    const maxSteps = resolveSubAgentSteps(requestedMaxSteps);

    this.logger.log(
      `子 agent 启动: sessionKey=${sessionKey ?? 'UNDEFINED'}, task="${task.slice(0, 40)}..."`,
    );
    if (signal?.aborted) {
      return toolResult('委派已取消', undefined, {
        status: 'error',
        stepsUsed: 0,
        steps: [],
      });
    }

    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      return '子 agent 执行失败：AI 配置不完整';
    }

    const runtime = await this.piRuntime.createRuntime(aiConfig, tier);

    const webSearchProvider = createWebSearchProviderFromEnv();
    const webFetchProvider = createWebFetchProviderFromEnv();

    // 只读工具集：不装配任何记忆、审批或写入工具，也不允许嵌套 sub_agent。
    const tools = applyToolDescriptions({
      search_knowledge_base: createSearchKnowledgeBaseTool(this.contentService),
      list_knowledge_base: createListKnowledgeBaseTool(this.contentService),
      read_document_content: createReadDocumentContentTool(
        this.noteViewService,
      ),
      get_current_draft: createGetCurrentDraftTool(
        () => parentContext.document,
      ),
      ...(webSearchProvider
        ? { web_search: createWebSearchTool(webSearchProvider) }
        : {}),
      web_fetch: createWebFetchTool(webFetchProvider, this.externalCacheRepo),
      ...(parentContext.learningTopicId || parentContext.learningNoteId
        ? {
            read_content: createReadContentTool(
              this.noteViewService,
              this.editorDraftRepo,
            ),
          }
        : {}),
    });

    let stepsUsed = 0;
    let resourcesRead = 0;
    // 每步记录:工具名 + 该步反馈统计(= 该工具结果的 summary),前端逐行展示「工具 · 统计」
    const stepRecords: Array<{
      step: number;
      tools: Array<{ name: string; summary: string }>;
    }> = [];

    const startTime = Date.now();
    this.logger.log(
      `子 agent 开始: "${task.slice(0, 50)}…" (max ${maxSteps} steps)`,
    );

    let turnTools: Array<{ name: string; summary: string }> = [];
    const invalidToolNamesByTurn: Array<ReadonlySet<string>> = [];
    const agent = await this.piRuntime.createAgent({
      initialState: {
        systemPrompt: this.promptManager.render('sub-agent/researcher.md'),
        model: runtime.model,
        tools: adaptToolsForPi(tools),
        messages: [],
        thinkingLevel: tier === 'think' ? 'high' : 'off',
      },
      streamFn: runtime.streamFn,
      sessionId: sessionKey,
      toolExecution: 'parallel',
      shouldStopAfterTurn: () =>
        stepsUsed >= maxSteps ||
        hasRepeatedInvalidToolNames(invalidToolNamesByTurn, 2),
    });

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        return;
      }
      if (event.type === 'tool_execution_end') {
        const parsedResult = this.extractToolResult(event.result);
        const name = event.toolName;
        if (
          READ_TOOL_NAMES.has(name) &&
          parsedResult?.meta?.status === 'ok' &&
          parsedResult.meta.source !== 'none'
        ) {
          resourcesRead += 1;
        }
        turnTools.push({ name, summary: parsedResult?.summary ?? '' });
        return;
      }
      if (event.type !== 'turn_end') return;
      // Pi 先发 turn_end，再执行 shouldStopAfterTurn。步数必须在事件中先递增，
      // 否则首步进度会被记为 0，上限判断也会晚一轮。
      stepsUsed += 1;
      invalidToolNamesByTurn.push(
        new Set(
          event.toolResults
            .filter(isPiToolResultInvalid)
            .map((result) => result.toolName),
        ),
      );
      if (invalidToolNamesByTurn.length > 2) invalidToolNamesByTurn.shift();
      if (turnTools.length === 0) return;
      const record = { step: stepsUsed, tools: turnTools };
      stepRecords.push(record);
      if (sessionKey) {
        this.eventEmitter.emit('sub-agent.step', {
          sessionKey,
          step: stepsUsed,
          tools: turnTools,
        });
      }
      this.logger.debug(
        `子 agent step=${stepsUsed} tools=${turnTools.map((tool) => tool.name).join(',')}`,
      );
      turnTools = [];
    });

    // 墙钟超时是防挂死边界；父 agent 的 AbortSignal 同步向下传播。
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      agent.abort();
    }, AI_RUNTIME_LIMITS.subAgentTimeoutMs);
    const onParentAbort = () => agent.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      await agent.prompt(buildSubAgentPrompt(task, parentContext));

      clearTimeout(timeout);
      if (timedOut) throw new Error('子 agent 超时');
      if (signal?.aborted) throw new Error('子 agent 已被上级取消');
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `子 agent 完成: ${stepsUsed} steps, ${resourcesRead} resources, ${elapsed}s`,
      );

      const conclusion =
        readLastAssistantText(agent.state.messages) || '子 agent 未生成结论';

      // 统一契约:summary = 一行结果统计;完整研究报告进 detail 给主 agent 消费。
      // 子 agent 是黑盒,前端只显示这一行,不展开内部步骤。
      // 头部 = 整体结果统计;每步明细在 meta.steps(前端 StepList 逐行展开)
      const hitLimit = stepsUsed >= maxSteps;
      const stat = resourcesRead > 0 ? ` · 读取 ${resourcesRead} 份资料` : '';
      return toolResult(
        hitLimit ? `未完成 · 达步数上限,结论可能不全${stat}` : `完成${stat}`,
        conclusion,
        {
          status: hitLimit ? 'partial' : 'ok',
          stepsUsed,
          resourcesRead,
          elapsed,
          steps: stepRecords,
        },
      );
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = timedOut;
      this.logger.error(
        `子 agent ${isTimeout ? '超时' : '失败'}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      return toolResult(
        isTimeout
          ? `未完成 · 超时(${Math.round(AI_RUNTIME_LIMITS.subAgentTimeoutMs / 60_000)} 分钟上限),已 ${stepsUsed} 步`
          : `委派失败:${msg}`,
        undefined,
        {
          status: isTimeout ? 'timeout' : 'error',
          stepsUsed,
          steps: stepRecords,
        },
      );
    } finally {
      clearTimeout(timeout);
      unsubscribe();
      signal?.removeEventListener('abort', onParentAbort);
      if (sessionKey) {
        this.eventEmitter.emit('sub-agent.done', { sessionKey });
      }
    }
  }

  /** 解析统一工具结果，供步骤反馈和成功读取统计复用。 */
  private extractToolResult(
    res: unknown,
  ): { summary?: string; meta?: Record<string, unknown> } | null {
    try {
      const out = readPiToolOutput(res);
      const s = typeof out === 'string' ? out : JSON.stringify(out);
      return JSON.parse(s) as {
        summary?: string;
        meta?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  }
}

function readLastAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (message.role !== 'assistant') continue;
    return (message.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');
  }
  return '';
}
