/**
 * SubAgentService — 子 agent 执行器。
 *
 * 主 agent 通过 sub_agent 工具委派任务，子 agent 有：
 * - 独立的 context window（不污染主对话）
 * - 只读工具集（search_knowledge_base + read_document_content + get_current_draft）
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
import { createReadDocumentContentTool } from '../tools/read-content.tool';
import { createGetCurrentDraftTool } from '../tools/get-current-document.tool';
import { bridgeToolSchemas } from '../agent.utils';
import type { DocumentContext } from '../tools/get-current-document.tool';

@Injectable()
export class SubAgentService {
  private readonly logger = new Logger(SubAgentService.name);

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 执行子 agent 任务。
   *
   * @param task 任务描述（主 agent 委派的明确指令）
   * @param document 当前编辑文档（可选，用于 get_current_draft）
   * @param maxSteps 最大推理步数，默认 8
   * @param tier 模型层级，默认 standard
   */
  async execute(params: {
    task: string;
    document?: DocumentContext;
    maxSteps?: number;
    tier?: string;
    sessionKey?: string;
  }): Promise<string> {
    const { task, document, maxSteps = 8, tier = 'standard', sessionKey } = params;

    this.logger.log(`子 agent 启动: sessionKey=${sessionKey ?? 'UNDEFINED'}, task="${task.slice(0, 40)}..."`);

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

    // 只读工具集：不能写记忆，不能嵌套 sub_agent
    // AI SDK v6 workaround：bridgeToolSchemas 保证 parameters / inputSchema 两个字段都存在
    const tools = bridgeToolSchemas({
      search_knowledge_base: createSearchKnowledgeBaseTool(this.contentService),
      read_document_content: createReadDocumentContentTool(
        this.noteViewService,
      ),
      get_current_draft: createGetCurrentDraftTool(document),
    });

    let stepsUsed = 0;
    let documentsRead = 0;
    const stepRecords: Array<{ step: number; tools: Array<{ name: string; args: string }> }> = [];

    const startTime = Date.now();
    this.logger.log(
      `子 agent 开始: "${task.slice(0, 50)}…" (max ${maxSteps} steps)`,
    );

    // 60 秒超时
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 60_000);

    try {
      const result = await generateText({
        model,
        abortSignal: abortController.signal,
        system: `你是一个研究助手。你的任务是完成主 agent 委派给你的子任务，然后返回结论。

你有以下工具可用：
- search_knowledge_base：搜索所有者知识库
- read_document_content：读取一篇已发布内容的正文
- get_current_draft：获取当前编辑的草稿

约束：
- 你不能记忆任何信息（没有 remember/forget 工具）
- 你不能委派子任务（没有 sub_agent 工具）
- 完成任务后，用清晰的结构化文本返回你的发现
- 效率优先，不要读取不必要的文档
- 回答使用中文`,
        prompt: task,
        tools,
        maxSteps,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: (event) => {
          const { stepNumber } = event;
          stepsUsed++;

          // AI SDK v6 有 toolCalls / staticToolCalls / dynamicToolCalls 三种字段，
          // 优先用 staticToolCalls（我们的工具用 jsonSchema 定义），fallback 到其他
          const rawCalls: any[] =
            (event as any).staticToolCalls?.length ? (event as any).staticToolCalls
            : (event as any).toolCalls?.length ? (event as any).toolCalls
            : (event as any).dynamicToolCalls ?? [];
          this.logger.log(`  子 agent step ${stepNumber}: ${rawCalls.length} tool calls`);

          documentsRead += rawCalls.filter(
            (t: any) => (t.toolName ?? t.name) === 'read_document_content',
          ).length;
          if (rawCalls.length > 0) {
            const stepTools = rawCalls.map((t: any) => ({
              name: t.toolName ?? t.name ?? 'unknown',
              args: this.summarizeArgs(
                t.toolName ?? t.name ?? '',
                (t.args ?? t.input ?? {}) as Record<string, unknown>,
              ),
            }));
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
              `  子 agent step ${stepNumber}: ${toolCalls.map((t) => t.toolName).join(', ')}`,
            );
          }
        },
      });

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

      // 返回 JSON 结构（前端完成后也能看到完整步骤）
      return JSON.stringify({
        conclusion,
        steps: stepRecords,
        stats: { stepsUsed, documentsRead, elapsed },
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('abort');
      this.logger.error(`子 agent ${isTimeout ? '超时' : '失败'}: ${msg}`);
      return isTimeout
        ? `子 agent 执行超时（60秒限制），已完成 ${stepsUsed} 步`
        : `子 agent 执行失败：${msg}`;
    }
  }

  /** 把工具参数压缩为一行人类可读的摘要（前端渲染嵌套步骤用） */
  private summarizeArgs(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'search_knowledge_base':
        return String(args.query ?? '');
      case 'read_document_content':
        return String(args.contentItemId ?? '').slice(0, 12);
      case 'get_current_draft':
        return '';
      default:
        return '';
    }
  }
}
