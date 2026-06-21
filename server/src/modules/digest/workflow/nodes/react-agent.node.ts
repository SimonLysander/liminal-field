/**
 * ReactAgentNode — 工作流第 1 节点：ReAct loop（generateText + stepCountIs + 4 工具）。
 *
 * 功能：用 LLM 自主 browse/web_search/web_fetch/pick，将命中条目累积进 DigestTask.findings。
 * 完成后 caller 从 taskRepo.findById 读 findings——本节点不返回 findings，通过 DB 传递。
 *
 * 模型解析：抄 sub-agent.service.ts 的 resolveModel 模式（SystemConfigService.getAiConfig）。
 * repair：直接用 makeRepairToolCall（agent.utils.ts），与 sub-agent 保持一致。
 *
 * 订阅源列表注入策略（v4）：
 *   - 选择方案：render(react-agent.md) + 字符串拼接订阅源列表作为 system prompt 后缀。
 *   - 未选占位符方案，原因：订阅源列表是运行时数据库数据，render 时无法提前知道；
 *     而 PromptManagerService 是同步 render（读文件 + Handlebars），注入 DB 数据需异步，
 *     因此在 execute() 里查完源后直接拼字符串更自然，职责清晰。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import type { StepResult, ToolSet } from 'ai';
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import { InfoSourceRepository } from '../../info-source.repository';
import { ContentRepository } from '../../../content/content.repository';
import { SystemConfigService } from '../../../settings/system-config.service';
import { makeRepairToolCall } from '../../../agent/agent.utils';
import { DigestTaskRepository } from '../../digest-task.repository';
import type { AgentStep } from '../../digest-task.entity';
// P3 重构:不再依赖 DigestToolsFactory(已删),改用 agent 的 ToolAssembler——
// 工具池全项目共有,workflow 跑 react-agent 跟 report-analyst sub-agent 走同一套工具
import { ToolAssembler } from '../../../agent/lifecycle/tool.assembler';
import type { DigestTaskContext } from '../../../agent/tools/digest-task-context';

@Injectable()
export class ReactAgentNode {
  private readonly logger = new Logger(ReactAgentNode.name);

  constructor(
    private readonly promptManager: PromptManagerService,
    private readonly stcRepo: SmartTopicConfigRepository,
    private readonly infoSourceRepo: InfoSourceRepository,
    private readonly contentRepo: ContentRepository,
    private readonly toolAssembler: ToolAssembler,
    private readonly systemConfigService: SystemConfigService,
    private readonly taskRepository: DigestTaskRepository,
  ) {}

  /**
   * 执行 ReAct loop。
   * 副作用：通过 pick 工具将 findings 写入 DigestTask（DB 传递，不 return）。
   */
  async run(taskId: string, topicId: string): Promise<void> {
    this.logger.log(`[react-agent] 启动 taskId=${taskId} topicId=${topicId}`);

    const [stc, item] = await Promise.all([
      this.stcRepo.findByContentItemId(topicId),
      this.contentRepo.findById(topicId),
    ]);

    const topicName = item?.latestVersion?.title ?? '未命名事项';
    const topicPrompt = stc?.prompt ?? '请收集相关信息';

    // 拉订阅源列表，拼成 system prompt 后缀（运行时 DB 数据，不能放 md 模板里）
    const subscribedSourcesSection = await this.buildSubscribedSourcesSection(
      stc?.sourceIds ?? [],
    );

    const baseSystemPrompt = this.promptManager.render(
      'digest/react-agent.md',
      {
        topic_name: topicName,
        topic_prompt: topicPrompt,
      },
    );

    // 订阅源列表追加在 prompt 尾部，作为"运行时上下文"与"指令模板"分离
    const systemPrompt = subscribedSourcesSection
      ? `${baseSystemPrompt}\n\n${subscribedSourcesSection}`
      : baseSystemPrompt;

    // 构建 digest workflow 用的 task context(browse + pick 共享 state)
    const digestTaskContext: DigestTaskContext = {
      taskId,
      topicId,
      refCounter: { item: 0 },
      fetchedItemsMap: new Map(),
    };
    // 走统一的 ToolAssembler — 工具池全项目共有
    // workflow 入口配置可能没存,显式传 allowedTools 限定 4 个工具集
    const tools = this.toolAssembler.assemble(
      { digestTaskContext },
      ['browse', 'web_search', 'web_fetch', 'pick'],
      'standard',
    );

    const aiConfig = await this.systemConfigService.getAiConfig('standard');
    const provider = createOpenAICompatible({
      name: 'digest-react-agent',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    const model = provider.chatModel(aiConfig.model);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: '开始本次收集。' }],
      // DigestToolset 是具名类型，AI SDK 要求 ToolSet（带 index signature）
      tools: tools as any,
      // maxSteps 从事项配置读取，老数据 / 未配置时兜底 20
      stopWhen: stepCountIs(stc?.maxSteps ?? 20),
      experimental_repairToolCall: makeRepairToolCall(model),
      // 边跑边把每步 tool_call + result 摘要写进 DigestTask.steps，不存抓取全文
      onStepFinish: async (step: StepResult<ToolSet>) => {
        for (const tc of step.toolCalls ?? []) {
          const tr = step.toolResults?.find(
            (r) => r.toolCallId === tc.toolCallId,
          );
          await this.writeAgentStep(taskId, tc, tr);
        }
      },
    });

    this.logger.log(
      `[react-agent] 完成 taskId=${taskId} steps=${result.steps?.length ?? 0}`,
    );
  }

  /**
   * 把一个工具调用 + 结果摘要写进 DigestTask.steps。
   * 不存 detail（web_fetch markdown / web_search content / browse snippet 全文）。
   * 通过 ToolResult.output（JSON string）取 summary + meta 数值字段。
   */
  private async writeAgentStep(
    taskId: string,
    toolCall: { toolName: string; input?: unknown; toolCallId: string },
    toolResult: { toolCallId: string; output?: unknown } | undefined,
  ): Promise<void> {
    let summary = '';
    let meta: Record<string, number | string> | undefined;
    let error: string | undefined;

    if (toolResult) {
      try {
        // output 可能是 JSON 字符串（toolResult() 序列化），也可能已经是对象
        const parsed: unknown =
          typeof toolResult.output === 'string'
            ? JSON.parse(toolResult.output)
            : toolResult.output;

        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, unknown>;
          summary = typeof p.summary === 'string' ? p.summary : '';
          // errorCode 来自工具 return toolResult(..., { errorCode: '...' })
          if (typeof p.errorCode === 'string') error = p.errorCode;
          // meta：只取数值类型的字段，跳过 detail/list/items 等大对象
          if (p.meta && typeof p.meta === 'object') {
            const numericMeta: Record<string, number | string> = {};
            for (const [k, v] of Object.entries(
              p.meta as Record<string, unknown>,
            )) {
              if (typeof v === 'number' || typeof v === 'string') {
                numericMeta[k] = v;
              }
            }
            if (Object.keys(numericMeta).length) meta = numericMeta;
          }
        }
      } catch {
        summary = '（结果解析失败）';
      }
    }

    const step: AgentStep = {
      ts: new Date(),
      toolName: toolCall.toolName,
      args: this.sanitizeArgs(toolCall.input),
      summary,
      meta,
      // generateText.onStepFinish 不直接提供单工具耗时，暂记 0
      durationMs: 0,
      error,
    };

    await this.taskRepository.appendStep(taskId, step);
    this.logger.debug(
      `[react-agent] step written taskId=${taskId} tool=${toolCall.toolName} summary="${summary.slice(0, 60)}"`,
    );
  }

  /**
   * 入参精简：去掉可能很大的字段（预留过滤）。长字符串截断 200 字。
   */
  private sanitizeArgs(args: unknown): Record<string, unknown> {
    if (!args || typeof args !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 200) {
        out[k] = `${v.slice(0, 200)}…`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * 构建订阅源列表段落，供 system prompt 注入。
   *
   * 格式示例：
   *   你已订阅的信息源：
   *   - src_abc123 · HuggingFace Papers — AI 每日 trending 论文 (https://huggingface.co/papers.rss)
   *   - src_def456 · Hacker News Frontpage — YC 系开发者每日必看 (https://hnrss.org/frontpage)
   *
   * 无订阅源时返回空字符串（不拼入 prompt）。
   */
  private async buildSubscribedSourcesSection(
    sourceIds: string[],
  ): Promise<string> {
    if (sourceIds.length === 0) return '';

    const sources = await this.infoSourceRepo.findManyByIds(sourceIds);
    if (sources.length === 0) return '';

    const lines = sources.map((s) => {
      const url = (s.config?.url as string | undefined) ?? '';
      // 描述从 name 里取（InfoSource 暂无 description 字段，用 URL 辅助定位）
      const urlHint = url ? ` (${url})` : '';
      return `- ${s._id} · ${s.name}${urlHint}`;
    });

    return `你已订阅的信息源（browse 时直接传 sourceId）：\n${lines.join('\n')}`;
  }
}
