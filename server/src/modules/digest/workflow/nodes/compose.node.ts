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
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { DigestTask } from '../../digest-task.entity'; // 非注入参数，保留 type import
import { SystemConfigService } from '../../../settings/system-config.service';

export const ComposeSchema = z.object({
  headline: z.string().max(50),
  /** 本期 deck — "本期 N 篇:主题 1 / 主题 2 / 主题 3" 目录式概要,告诉读者"这一期有哪几篇/讲什么";
   *  报头大字标题之下 italic 大字渲染。max 200 防 LLM 失控写成一段。required — 由 prompt 强制输出。 */
  deck: z.string().min(1).max(200),
  markdown: z.string(),
});

export type ComposeOutput = z.infer<typeof ComposeSchema>;

/**
 * findings 序列化为 compose prompt 里的 {{findings_text}}。
 *
 * 字段顺序: title → 事实摘要(reason, agent web_fetch 后整理过的多事实点) → 原 snippet(RSS 给的简短描述,补充背景)。
 * 把 reason 放在前面+加 "**事实摘要**" 强调,是因为 reason 经过 agent 多轮信息收集后整理,信息密度远高于 RSS snippet。
 * compose-report.md 里的 prompt 引导 LLM 优先用 reason 写成段陈述,snippet 当背景。
 */
function buildFindingsText(task: DigestTask): string {
  if (task.findings.length === 0) return '（无 findings）';
  return task.findings
    .map((f) => {
      const date = f.publishedAt
        ? f.publishedAt.toISOString().slice(0, 10)
        : '日期未知';
      return `[@#CIT ${f.citationId}] ${f.title}（${f.sourceName}，${date}）\n**事实摘要**(主要事实源,agent 整理):\n${f.reason}\n\n**原文摘要**(RSS/snippet,补充背景):\n${f.snippet}`;
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
