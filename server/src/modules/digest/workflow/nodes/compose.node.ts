/**
 * ComposeNode — 工作流第 2 节点：把 findings 写成 markdown 报告。
 *
 * 输入：DigestTask（含 findings 列表，每条有 citationId / title / snippet / reason）。
 * 输出：{ headline, markdown }（zod 强校验）。
 *
 * 使用 generateObject 而非 generateText——强制 LLM 输出符合 ComposeSchema 的 JSON，
 * 避免 parse 错误导致 commit 节点拿到无效数据。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { DigestTask } from '../../digest-task.entity';
import type { SystemConfigService } from '../../../settings/system-config.service';

export const ComposeSchema = z.object({
  headline: z.string().max(50),
  markdown: z.string(),
});

export type ComposeOutput = z.infer<typeof ComposeSchema>;

/** findings 序列化为 compose prompt 里的 {{findings_text}} */
function buildFindingsText(task: DigestTask): string {
  if (task.findings.length === 0) return '（无 findings）';
  return task.findings
    .map((f) => {
      const date = f.publishedAt
        ? f.publishedAt.toISOString().slice(0, 10)
        : '日期未知';
      return `[CIT ${f.citationId}] ${f.title}（${f.sourceName}，${date}）\n${f.snippet}\n理由：${f.reason}`;
    })
    .join('\n\n---\n\n');
}

@Injectable()
export class ComposeNode {
  private readonly logger = new Logger(ComposeNode.name);

  constructor(
    private readonly promptManager: PromptManagerService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async run(task: DigestTask): Promise<ComposeOutput> {
    this.logger.log(
      `[compose] 开始 taskId=${task._id} findings=${task.findings.length}`,
    );

    const topicName = String(task.topicId); // 调用方可传更好的名字，此处最小化依赖
    const findingsText = buildFindingsText(task);

    const prompt = this.promptManager.render('digest/compose-report.md', {
      topic_name: topicName,
      findings_text: findingsText,
    });

    const aiConfig = await this.systemConfigService.getAiConfig('standard');
    const provider = createOpenAICompatible({
      name: 'digest-compose',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    const model = provider.chatModel(aiConfig.model);

    const { object } = await generateObject({
      model,
      schema: ComposeSchema,
      prompt,
    });

    this.logger.log(
      `[compose] 完成 taskId=${task._id} headline="${object.headline}" markdownLen=${object.markdown.length}`,
    );

    return object;
  }
}
