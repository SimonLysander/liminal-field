/**
 * ComposeNode — 工作流第 2 节点：把 findings 写成 markdown 报告。
 *
 * 输入：DigestTask（含 findings 列表，每条有 citationId / title / snippet / reason）。
 * 输出：{ headline, deck, markdown }（zod safeParse 强校验）。
 *
 * 为什么用 generateText 而非 generateObject:
 *   generateObject 依赖 provider 的 structured outputs(json_schema)能力,而线上模型
 *   deepseek-v4-pro 只支持 json_object(JSON mode)、不支持 json_schema——撞上去直接崩
 *   "No object generated: response did not match schema"(线上简报因此全部生成失败)。
 *   改用 generateText 走 JSON mode:prompt(compose-report.md)已要求输出合法 JSON 并给出
 *   结构示例(满足 DeepSeek JSON mode 的"含 json 字样 + 给示例"要求),拿到文本后用
 *   extractJSON 兜底提取、再用 ComposeSchema.safeParse 严格校验字段。
 *   同款方案见 memory-agent.service —— 全项目对"provider 不支持 structured output"的统一解法。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { z } from 'zod';
// extractJSON:从 LLM 文本里兜底提取 JSON(纯 JSON / ```json 代码块 / 花括号截取)
import { extractJSON } from '../../../agent/agent.utils';
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

    const { text } = await generateText({
      model,
      prompt,
      // 给足输出预算:正文 1500-3500 字,DeepSeek 默认 max_tokens 偏低会把 JSON 写到一半截断
      // → extractJSON 拿到残缺 JSON 解析失败。8192 覆盖 headline+deck+markdown 的完整 JSON。
      maxOutputTokens: 8192,
    });

    // 1) 兜底提取 JSON(模型可能用 ```json 包裹或夹带说明文字)
    let raw: unknown;
    try {
      raw = extractJSON<unknown>(text);
    } catch (err) {
      // 失败必带上下文:响应长度 + 头部摘要(不记全文——可能很长且含正文)
      this.logger.error(
        `[compose] JSON 提取失败 taskId=${task._id} textLen=${text.length} head="${text.slice(0, 200)}"`,
      );
      throw err;
    }

    // 2) zod 严格校验字段(headline≤50 / deck 1-200 / markdown 必填),保证 commit 拿到合法数据
    const parsed = ComposeSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        `[compose] 输出不符合 ComposeSchema taskId=${task._id} textLen=${text.length} ` +
          `head="${text.slice(0, 200)}" zodError=${parsed.error.message}`,
      );
      throw new Error('compose 输出不符合 ComposeSchema');
    }
    const object = parsed.data;

    this.logger.log(
      `[compose] 完成 taskId=${task._id} headline="${object.headline}" markdownLen=${object.markdown.length}`,
    );

    return object;
  }
}
