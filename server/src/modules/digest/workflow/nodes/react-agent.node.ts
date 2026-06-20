/**
 * ReactAgentNode — 工作流第 1 节点：ReAct loop（generateText + stepCountIs + 5 工具）。
 *
 * 功能：用 LLM 自主 browse/search/view/pick，将命中条目累积进 DigestTask.findings。
 * 完成后 caller 从 taskRepo.findById 读 findings——本节点不返回 findings，通过 DB 传递。
 *
 * 模型解析：抄 sub-agent.service.ts 的 resolveModel 模式（SystemConfigService.getAiConfig）。
 * repair：直接用 makeRepairToolCall（agent.utils.ts），与 sub-agent 保持一致。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { ContentRepository } from '../../../content/content.repository';
import type { DigestToolsFactory } from '../../tools/digest-tools.factory';
import type { SystemConfigService } from '../../../settings/system-config.service';
import { makeRepairToolCall } from '../../../agent/agent.utils';

@Injectable()
export class ReactAgentNode {
  private readonly logger = new Logger(ReactAgentNode.name);

  constructor(
    private readonly promptManager: PromptManagerService,
    private readonly stcRepo: SmartTopicConfigRepository,
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

    const systemPrompt = this.promptManager.render('digest/react-agent.md', {
      topic_name: topicName,
      topic_prompt: topicPrompt,
    });

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
}
