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
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import { InfoSourceRepository } from '../../info-source.repository';
import { ContentRepository } from '../../../content/content.repository';
import { DigestToolsFactory } from '../../tools/digest-tools.factory';
import { SystemConfigService } from '../../../settings/system-config.service';
import { makeRepairToolCall } from '../../../agent/agent.utils';

@Injectable()
export class ReactAgentNode {
  private readonly logger = new Logger(ReactAgentNode.name);

  constructor(
    private readonly promptManager: PromptManagerService,
    private readonly stcRepo: SmartTopicConfigRepository,
    private readonly infoSourceRepo: InfoSourceRepository,
    private readonly contentRepo: ContentRepository,
    private readonly toolsFactory: DigestToolsFactory,
    private readonly systemConfigService: SystemConfigService,
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

    const ctx = this.toolsFactory.createTaskContext(taskId, topicId);
    const tools = this.toolsFactory.buildToolset(ctx);

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
      stopWhen: stepCountIs(20),
      experimental_repairToolCall: makeRepairToolCall(model),
    });

    this.logger.log(
      `[react-agent] 完成 taskId=${taskId} steps=${result.steps?.length ?? 0}`,
    );
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
