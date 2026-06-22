/**
 * ComposeNode — 工作流第 2 节点：把 findings 写成 markdown 报告。
 *
 * 输入：DigestTask（含 findings 列表）。输出：{ headline, deck, markdown }（zod 强校验）。
 *
 * 【分而治之】(2026-06 重构):早期"一次性把全部 findings 写成整篇报告",findings 多时
 * (实测 20 篇 / 47k 原文)输出超长 → DeepSeek 把 JSON 写崩/截断 → 整期失败。改成三阶段:
 *   1) Plan：只喂 title+reason(不喂原文)→ 分主题 + 定 headline/deck,输出小 JSON,稳。
 *   2) Write：按主题分别写,每节只喂该组原文 → 每次输出小、可并行;输出裸 markdown,避开 JSON 转义。
 *   3) Assemble：纯代码拼 headline + deck + 各主题(## 标题 + 正文)。
 * 每次 LLM 调用的输入/输出都可控,根治"单次超长崩溃"。
 *
 * 为什么 Plan 用 generateText 而非 generateObject:
 *   deepseek-v4-pro 只支持 json_object(JSON mode)、不支持 json_schema,generateObject 直接崩
 *   ("No object generated")。改 generateText + JSON mode(prompt 给结构示例)+ extractJSON 兜底
 *   + zod 校验。同款方案见 memory-agent.service。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
// extractJSON:从 LLM 文本里兜底提取 JSON(纯 JSON / ```json 代码块 / 花括号截取)
import { extractJSON } from '../../../agent/agent.utils';
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { DigestTask, Finding } from '../../digest-task.entity'; // 非注入参数，保留 type import
import { SystemConfigService } from '../../../settings/system-config.service';

// 最终产出(commit 节点消费)。字数靠 prompt 软约束,schema 只设宽松上限防极端失控。
export const ComposeSchema = z.object({
  headline: z.string().min(1).max(120),
  /** 本期 deck — 概括导语;报头大字标题下渲染。 */
  deck: z.string().min(1).max(600),
  markdown: z.string().min(1),
});

export type ComposeOutput = z.infer<typeof ComposeSchema>;

/**
 * Plan 阶段产出：分类大纲(小输出,稳)。topics 把 findings 按 citationId 分组,
 * title 是客观归类名,citationIds 引用 findings 的 citationId。
 */
const PlanSchema = z.object({
  headline: z.string().min(1).max(120),
  deck: z.string().min(1).max(600),
  topics: z
    .array(
      z.object({
        title: z.string().min(1),
        citationIds: z.array(z.number()).min(1),
      }),
    )
    .min(1),
});
type Plan = z.infer<typeof PlanSchema>;

/** XML 属性值转义(只转义会破坏属性的字符;正文不转义,保留 markdown 原貌) */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 一组 findings 序列化为 write 阶段的 {{sources_xml}} —— 结构化 XML。
 * 每条 <source>:引用源信息(cit/title/from/date/url) + reason(挑它的理由) → 属性;
 * 正文 = fulltext(web_fetch 一手原文),缺失时退回 snippet(RSS 背景)。
 * write 基于 <source> 正文写报告,引用就近标 [@#CIT cit]。
 */
function buildSourcesXml(findings: Finding[]): string {
  if (findings.length === 0) return '<sources></sources>';
  const items = findings.map((f) => {
    const date = f.publishedAt ? f.publishedAt.toISOString().slice(0, 10) : '';
    // 正文优先一手原文,没有(只看 snippet 就 pick 的)退回 RSS 摘要
    const body =
      f.fulltext?.trim() || f.snippet?.trim() || '（无正文,仅标题元信息）';
    const attrs = [
      `cit="${f.citationId}"`,
      `title="${escapeAttr(f.title)}"`,
      `from="${escapeAttr(f.sourceName)}"`,
      date ? `date="${date}"` : '',
      `url="${escapeAttr(f.url)}"`,
      `reason="${escapeAttr(f.reason)}"`,
    ]
      .filter(Boolean)
      .join(' ');
    return `<source ${attrs}>\n${body}\n</source>`;
  });
  return `<sources>\n${items.join('\n\n')}\n</sources>`;
}

/**
 * Plan 阶段输入:每篇一行 title + 来源 + reason(**不含原文** → 输入小,只用于分主题/定刊头)。
 * 把原文留到 write 阶段按主题分批喂,是"分而治之"省 token、防超长的关键。
 */
function buildPlanInput(findings: Finding[]): string {
  if (findings.length === 0) return '（无 findings）';
  return findings
    .map((f) => {
      const date = f.publishedAt
        ? `,${f.publishedAt.toISOString().slice(0, 10)}`
        : '';
      return `[#${f.citationId}] ${f.title}（${f.sourceName}${date}）\n  理由:${f.reason}`;
    })
    .join('\n');
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
    const aiConfig = await this.systemConfigService.getAiConfig('standard');
    const provider = createOpenAICompatible({
      name: 'digest-compose',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    const model = provider.chatModel(aiConfig.model);

    // ── 阶段 1: Plan —— 只用 title+reason 分主题 + 定 headline/deck(输入/输出都小,稳)
    const plan = await this.plan(model, task, topicName);
    this.logger.log(
      `[compose] plan 完成 taskId=${task._id} topics=${plan.topics.length} headline="${plan.headline}"`,
    );

    // 兜底:plan 漏掉的 findings(没归入任何主题)收进末尾「其他」,不丢内容
    const byCit = new Map(task.findings.map((f) => [f.citationId, f]));
    const covered = new Set(plan.topics.flatMap((t) => t.citationIds));
    const uncovered = task.findings.filter((f) => !covered.has(f.citationId));
    if (uncovered.length > 0) {
      this.logger.warn(
        `[compose] plan 未覆盖 ${uncovered.length} 条 findings → 归入兜底主题「其他」 taskId=${task._id}`,
      );
      plan.topics.push({
        title: '其他',
        citationIds: uncovered.map((f) => f.citationId),
      });
    }

    // ── 阶段 2: Write —— 按主题并行写,每节只喂该组原文(每次输出小,避免超长崩;输出裸 markdown)
    // 单节 write 失败(LLM 偶发 / reasoning 预算)只丢这一节并告警,不让整期崩——这正是分治的价值
    // (局部失败可隔离)。下方 assemble 过滤空节;全部失败再 throw。
    const sections = await Promise.all(
      plan.topics.map(async (topic) => {
        const findings = topic.citationIds
          .map((id) => byCit.get(id))
          .filter((f): f is Finding => !!f);
        if (findings.length === 0) return null; // plan 给了空/无效引用号
        try {
          const md = await this.writeSection(
            model,
            topicName,
            topic.title,
            findings,
          );
          return { title: topic.title, md: md.trim() };
        } catch (err) {
          this.logger.error(
            `[compose] 主题「${topic.title}」write 失败,跳过该节 taskId=${task._id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            err instanceof Error ? err.stack : undefined,
          );
          return null;
        }
      }),
    );

    // ── 阶段 3: Assemble —— 纯代码拼装(## 主题标题统一来自 plan,不依赖 write 模型)
    const markdown = sections
      .filter((s): s is { title: string; md: string } => !!s && s.md.length > 0)
      .map((s) => `## ${s.title}\n\n${s.md}`)
      .join('\n\n');
    if (!markdown) {
      throw new Error('compose: 所有主题小节均为空,无法拼装报告');
    }

    const parsed = ComposeSchema.safeParse({
      headline: plan.headline,
      deck: plan.deck,
      markdown,
    });
    if (!parsed.success) {
      this.logger.error(
        `[compose] 拼装结果不符合 ComposeSchema taskId=${task._id} zodError=${parsed.error.message}`,
      );
      throw new Error('compose 输出不符合 ComposeSchema');
    }

    this.logger.log(
      `[compose] 完成 taskId=${task._id} headline="${parsed.data.headline}" sections=${plan.topics.length} markdownLen=${markdown.length}`,
    );
    return parsed.data;
  }

  /** 阶段 1:分主题 + 定 headline/deck。只喂 title+reason,输出小 JSON。 */
  private async plan(
    model: LanguageModel,
    task: DigestTask,
    topicName: string,
  ): Promise<Plan> {
    const prompt = this.promptManager.render('digest/compose-plan.md', {
      topic_name: topicName,
      findings_list: buildPlanInput(task.findings),
    });
    // 8192:deepseek-v4-pro 带 reasoning,小预算(2048)会被思考过程吃光导致 content 为空(textLen=0)。
    const { text, finishReason } = await generateText({
      model,
      prompt,
      maxOutputTokens: 8192,
    });
    this.logger.debug(
      `[compose] plan 响应 taskId=${task._id} finishReason=${finishReason} textLen=${text.length}`,
    );

    let raw: unknown;
    try {
      raw = extractJSON<unknown>(text);
    } catch (err) {
      this.logger.error(
        `[compose] plan JSON 提取失败 taskId=${task._id} finishReason=${finishReason} textLen=${text.length} head="${text.slice(0, 200)}"`,
      );
      throw err;
    }
    const parsed = PlanSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        `[compose] plan 不符合 PlanSchema taskId=${task._id} zodError=${parsed.error.message}`,
      );
      throw new Error('compose plan 输出不符合 PlanSchema');
    }
    return parsed.data;
  }

  /** 阶段 2:写一个主题小节。只喂该组原文,输出裸 markdown(从 ### 篇名 开始,不含 ## 主题)。 */
  private async writeSection(
    model: LanguageModel,
    topicName: string,
    sectionTitle: string,
    findings: Finding[],
  ): Promise<string> {
    const prompt = this.promptManager.render(
      'digest/compose-write-section.md',
      {
        topic_name: topicName,
        section_title: sectionTitle,
        sources_xml: buildSourcesXml(findings),
      },
    );
    // 8192:同 plan,给 reasoning 留足空间,避免思考吃光预算后正文为空
    const { text, finishReason } = await generateText({
      model,
      prompt,
      maxOutputTokens: 8192,
    });
    this.logger.debug(
      `[compose] section「${sectionTitle}」finishReason=${finishReason} textLen=${text.length}`,
    );
    return text;
  }
}
