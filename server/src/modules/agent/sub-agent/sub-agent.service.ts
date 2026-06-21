/**
 * SubAgentService — 子 agent 执行器。
 *
 * 主 agent 通过 sub_agent 工具委派任务，子 agent 有：
 * - 独立的 context window（不污染主对话）
 * - 只读工具集（list_knowledge_base + search_knowledge_base + read_document_content + get_current_draft）
 * - 不能 remember / forget / sub_agent（不能写记忆，不能嵌套）
 *
 * 用 generateText（非流式）执行，完成后只把结论返回给主 agent。
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import { SystemConfigService } from '../../settings/system-config.service';
import { ContentService } from '../../content/content.service';
import { NoteViewService } from '../../workspace/note-view.service';
import { createSearchKnowledgeBaseTool } from '../tools/search-content.tool';
import { createListKnowledgeBaseTool } from '../tools/list-content.tool';
import { createReadDocumentContentTool } from '../tools/read-content.tool';
import { createGetCurrentDraftTool } from '../tools/get-current-document.tool';
import { makeRepairToolCall, retryOnce } from '../agent.utils';
import { toolResult } from '../tools/tool-result';
import type { DocumentContext } from '../tools/get-current-document.tool';
// 从 sub-agent/researcher.md 加载 system prompt(抽出散落字符串,统一托管)
import { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

@Injectable()
export class SubAgentService {
  private readonly logger = new Logger(SubAgentService.name);

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly eventEmitter: EventEmitter2,
    // PromptManagerService 是 @Global() 注入,无需 module import
    private readonly promptManager: PromptManagerService,
  ) {}

  /**
   * 执行子 agent 任务。
   *
   * @param task 任务描述（主 agent 委派的明确指令）
   * @param document 当前编辑文档（可选，用于 get_current_draft）
   * @param maxSteps 最大推理步数(≈ Claude Code 的 maxTurns;探索型研究取偏大),默认 12
   * @param tier 模型层级，默认 standard
   */
  async execute(params: {
    task: string;
    document?: DocumentContext;
    maxSteps?: number;
    tier?: string;
    sessionKey?: string;
  }): Promise<string> {
    const {
      task,
      document,
      maxSteps = 12,
      tier = 'standard',
      sessionKey,
    } = params;

    this.logger.log(
      `子 agent 启动: sessionKey=${sessionKey ?? 'UNDEFINED'}, task="${task.slice(0, 40)}..."`,
    );

    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      return '子 agent 执行失败：AI 配置不完整';
    }

    const provider = createOpenAICompatible({
      name: 'sub-agent',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    const model = provider.chatModel(aiConfig.model);

    // 只读工具集：不能写记忆，不能嵌套 sub_agent（tool() 已直接用 v6 的 inputSchema）
    const tools = {
      search_knowledge_base: createSearchKnowledgeBaseTool(this.contentService),
      list_knowledge_base: createListKnowledgeBaseTool(this.contentService),
      read_document_content: createReadDocumentContentTool(
        this.noteViewService,
      ),
      get_current_draft: createGetCurrentDraftTool(() => document),
    };

    let stepsUsed = 0;
    let documentsRead = 0;
    // 每步记录:工具名 + 该步反馈统计(= 该工具结果的 summary),前端逐行展示「工具 · 统计」
    const stepRecords: Array<{
      step: number;
      tools: Array<{ name: string; summary: string }>;
    }> = [];

    const startTime = Date.now();
    this.logger.log(
      `子 agent 开始: "${task.slice(0, 50)}…" (max ${maxSteps} steps)`,
    );

    // 墙钟超时仅作"防挂死"安全网(子 agent 是研究任务,真正边界靠 maxSteps,不是 Bash 那种 120s)
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 300_000);

    try {
      // 外层兜底:整轮抛错且未超时,重置 step 计数后重跑一次(repair 修不到的 provider 级抽风)
      const result = await retryOnce(
        () =>
          generateText({
            model,
            abortSignal: abortController.signal,
            // 从 sub-agent/researcher.md 加载 system prompt(原散落字符串 → promptManager 统一托管)
            system: this.promptManager.render('sub-agent/researcher.md'),
            prompt: task,
            tools,
            stopWhen: stepCountIs(maxSteps),
            // 工具调用烂 JSON 时 re-ask 修复,不让整轮委派崩(provider 偶发)
            experimental_repairToolCall: makeRepairToolCall(model),
            onStepFinish: (event) => {
              const { stepNumber } = event;
              stepsUsed++;

              // 工具调用统计(日志 + SSE 展示)：StepResult 的 toolCalls/staticToolCalls
              // 字段类型已暴露，直接用；优先 staticToolCalls（我们的工具 jsonSchema 定义）。
              const rawCalls = event.staticToolCalls?.length
                ? event.staticToolCalls
                : event.toolCalls?.length
                  ? event.toolCalls
                  : (event.dynamicToolCalls ?? []);
              this.logger.log(
                `  子 agent step ${stepNumber}: ${rawCalls.length} tool calls`,
              );

              documentsRead += rawCalls.filter(
                (t) => t.toolName === 'read_document_content',
              ).length;
              if (rawCalls.length > 0) {
                // 结果按 toolCallId 映射:每步显示该工具结果的 summary(= 同主流程"工具 + 反馈统计")
                const rawResults = event.staticToolResults?.length
                  ? event.staticToolResults
                  : (event.toolResults ?? []);
                const resById = new Map<string, unknown>();
                for (const r of rawResults) resById.set(r.toolCallId, r);

                const stepTools = rawCalls.map((t) => {
                  const name = t.toolName ?? 'unknown';
                  const summary =
                    this.extractSummary(resById.get(t.toolCallId)) ?? '';
                  return { name, summary };
                });
                stepRecords.push({ step: stepNumber, tools: stepTools });

                // 通过 EventEmitter 实时推送步骤给 SSE 端点
                if (sessionKey) {
                  this.eventEmitter.emit('sub-agent.step', {
                    sessionKey,
                    step: stepNumber,
                    tools: stepTools,
                  });
                }

                this.logger.log(
                  `  子 agent step ${stepNumber}: ${stepTools.map((t) => t.name).join(', ')}`,
                );
              }
            },
          }),
        {
          onRetry: () => {
            stepsUsed = 0;
            documentsRead = 0;
            stepRecords.length = 0;
            this.logger.warn('子 agent 首次执行失败,重置后重试一次');
          },
          aborted: () => abortController.signal.aborted,
        },
      );

      clearTimeout(timeout);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `子 agent 完成: ${stepsUsed} steps, ${documentsRead} docs, ${elapsed}s`,
      );

      const conclusion = result.text || '子 agent 未生成结论';

      // 通知前端子 agent 已完成
      if (sessionKey) {
        this.eventEmitter.emit('sub-agent.done', { sessionKey });
      }

      // 统一契约:summary = 一行结果统计(完成 + 读了几篇);conclusion 进 detail(给主 agent,不上页面)。
      // 子 agent 是黑盒,前端只显示这一行,不展开内部步骤。
      // 头部 = 整体结果统计;每步明细在 meta.steps(前端 StepList 逐行展开)
      const hitLimit = stepsUsed >= maxSteps;
      const stat = documentsRead > 0 ? ` · 读了 ${documentsRead} 篇` : '';
      return toolResult(
        hitLimit ? `未完成 · 达步数上限,结论可能不全${stat}` : `完成${stat}`,
        conclusion,
        {
          status: hitLimit ? 'partial' : 'ok',
          stepsUsed,
          documentsRead,
          elapsed,
          steps: stepRecords,
        },
      );
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('abort');
      this.logger.error(`子 agent ${isTimeout ? '超时' : '失败'}: ${msg}`);
      return toolResult(
        isTimeout
          ? `未完成 · 超时(300s 上限),已 ${stepsUsed} 步`
          : `委派失败:${msg}`,
        undefined,
        {
          status: isTimeout ? 'timeout' : 'error',
          stepsUsed,
          steps: stepRecords,
        },
      );
    }
  }

  /** 从工具结果(统一契约)里取 summary,作为该步的"反馈统计";取不到回 null */
  private extractSummary(res: unknown): string | null {
    try {
      const r = res as { output?: unknown; result?: unknown } | undefined;
      const out = r?.output ?? r?.result;
      const s = typeof out === 'string' ? out : JSON.stringify(out);
      const p = JSON.parse(s) as { summary?: string };
      return p.summary ?? null;
    } catch {
      return null;
    }
  }
}
