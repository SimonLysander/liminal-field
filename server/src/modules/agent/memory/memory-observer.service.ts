/**
 * MemoryObserverService — Aurora 的"潜意识观察者"(2026-05-30,#150 续 event log 架构)。
 *
 * 设计:
 * - 每轮 onAfterChat 钩子里同步 await 跑(不通过事件总线),让下一轮 prompt 看到新塑形
 * - 一次跑同时产出两件事:
 *   1. 本轮观察到的 0~N 条 observations(append 到 agent_memory_observations,永不动)
 *   2. 重派生的 current_view markdown(upsert 到 agent_memory_current_view)
 *   两件事同一次 LLM 调用完成,省 token + 省延迟
 * - 失败必须 catch + log,不阻塞用户对话
 *
 * 主 agent 完全不感知此 service 存在;它的存在不通过任何工具暴露。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { SystemConfigService } from '../../settings/system-config.service';
import { AgentMemoryObservationRepository } from './agent-memory-observation.repository';
import {
  OBSERVATION_TOPICS,
  type AgentMemoryObservation,
  type ObservationTopic,
} from './agent-memory-observation.entity';
import { extractJSON } from './memory-agent.service';

/** LLM 返回结构 */
interface ObserveLLMResult {
  /** 0~N 条:这一轮观察到的新东西(可为空数组) */
  observations: Array<{
    topic: ObservationTopic;
    observation: string;
    context?: string;
  }>;
  /**
   * 重派生的当前画像 markdown(基于"最近 100 条已有 observations + 本轮新增")
   * 按 topic 分段。如果没法派生(observations 太少 / 异常)返空字符串
   */
  currentView: string;
}

const TOPIC_LABELS: Record<ObservationTopic, string> = {
  identity: '身份',
  personality: '性格',
  aesthetic: '审美',
  method: '方法',
  other: '其他',
};

@Injectable()
export class MemoryObserverService {
  private readonly logger = new Logger(MemoryObserverService.name);

  constructor(
    private readonly observationRepo: AgentMemoryObservationRepository,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * 跑一次观察:读最近 observations + 本轮对话 → LLM 决策 append + 派生 view。
   *
   * - newMessages:本轮新增的 message(用户末条 + Aurora 完整回复)
   * - sessionKey:触发 chat 的 session(写入 observations.sessionKey 供溯源)
   * - tier:LLM 层级(默认 standard,可在配置里调)
   *
   * 失败不抛:返 { observationsAdded: 0 }(observer 失败绝不阻塞用户)
   */
  async observe(
    newMessages: Record<string, unknown>[],
    sessionKey?: string,
    tier?: string,
  ): Promise<{ observationsAdded: number }> {
    try {
      const newText = this.buildConversationText(newMessages);
      // 没有有效新对话 → 跳过(寒暄 / 空消息)
      if (newText.trim().length < 20) {
        return { observationsAdded: 0 };
      }

      const recentObservations = await this.observationRepo.findRecent(100);

      const result = await this.callObserverLLM(
        newText,
        recentObservations,
        tier,
      );

      // 过滤非法 topic(LLM 可能瞎写 → 落 other)
      const validated = result.observations.map((obs) => ({
        topic: OBSERVATION_TOPICS.includes(obs.topic) ? obs.topic : 'other',
        observation: obs.observation.slice(0, 500), // 长度守卫
        context: obs.context?.slice(0, 300),
        sessionKey,
      }));

      // 1. append 新 observations
      const created = await this.observationRepo.appendMany(validated);

      // 2. upsert current_view(LLM 同次产出,markdown 已带 topic 分段)
      if (result.currentView && result.currentView.trim().length > 0) {
        const totalCount = await this.observationRepo.count();
        await this.observationRepo.upsertCurrentView({
          markdown: result.currentView.slice(0, 8000), // 长度守卫
          observationCount: totalCount,
        });
      }

      this.logger.debug(
        `observe: 新增 ${created.length} 条 observations + ${result.currentView ? '更新' : '跳过'} current_view`,
      );
      return { observationsAdded: created.length };
    } catch (err) {
      // observer 失败绝不阻塞用户对话,只 log
      this.logger.error(
        `observe 失败 sessionKey=${sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { observationsAdded: 0 };
    }
  }

  // ─── 内部:对话文本构造 ────────────────────────────────────────

  /**
   * 把 messages 拍平成纯文本喂给 LLM。
   * 只取 user 和 assistant 的 text parts。
   */
  private buildConversationText(messages: Record<string, unknown>[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role as string;
      if (role !== 'user' && role !== 'assistant') continue;
      const parts = msg.parts as
        | Array<{ type: string; text?: string }>
        | undefined;
      const text =
        parts
          ?.filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('') ||
        (msg.content as string) ||
        '';
      if (!text.trim()) continue;
      lines.push(`[${role}]: ${text}`);
    }
    return lines.join('\n');
  }

  // ─── 内部:LLM 调用 ────────────────────────────────────────────

  private async getModel(tier: string = 'standard') {
    const aiConfig = await this.systemConfigService.getAiConfig(tier);
    const provider = createOpenAICompatible({
      name: 'memory-observer',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });
    return provider.chatModel(aiConfig.model);
  }

  private formatRecentObservations(
    observations: AgentMemoryObservation[],
  ): string {
    if (observations.length === 0)
      return '(暂无已有 observations,这是首轮观察)';
    return observations
      .map((o) => {
        const date = o.observedAt.toISOString().slice(0, 10);
        const ctx = o.context ? ` ⟨${o.context}⟩` : '';
        return `${date} [${o.topic}] ${o.observation}${ctx}`;
      })
      .join('\n');
  }

  private async callObserverLLM(
    newConversationText: string,
    recentObservations: AgentMemoryObservation[],
    tier?: string,
  ): Promise<ObserveLLMResult> {
    const model = await this.getModel(tier);
    const recentText = this.formatRecentObservations(recentObservations);

    const prompt = `你是 Aurora 的"潜意识观察者"——一个**后台**运行的记忆塑形器。
主 agent(Aurora)不知道你存在;你的输出不会被告知用户。
你的工作是:读本轮对话,决定有什么新东西值得**永久 append 到岁月史书**。

## 你看到的输入

(1) 本轮新对话:
${newConversationText}

(2) 最近 100 条已有 observations(防重复观察同一件事;格式 YYYY-MM-DD [topic] 观察内容 ⟨context⟩):
${recentText}

## Topic 字典(硬枚举,5 选 1)

- \`identity\` — 身份:客观属性 / 出厂底色(职业、教育、居住、语言文化等)
- \`personality\` — 性格:内在感受质地 / 性情倾向(性格特质、价值观、思维倾向、当下心境)
- \`aesthetic\` — 审美:觉得什么是好 / 美 / 对(跨场景一致的品味判断)
- \`method\` — 方法:怎么做事 / 思维模型(跨学科的操作系统、流程、节奏、工具)
- \`other\` — 兜底:实在塞不进上面 4 类时才用(谨慎)

## 关键区分

- 同一个偏好:**作为判断**(觉得 X 更好)→ aesthetic;**作为行动**(我会做 X)→ method
- 价值观(认为什么重要)→ personality(衡量方式),不是 aesthetic
- "在做什么"(学微积分 / 拍照 / 种花)不要单独立 topic,**放进 observation 的 context 字段**(如 \`聊到学微积分时\`)

## 输出规则

1. **岁月史书**:永远只 append,不修改已有 observation。即使新观察"覆盖"了旧的(比如换工作),也只是**新增一条**,旧的留着。
2. **去重**:已有 observations 里已经覆盖的内容(同样的话本月已观察过)不要重复 append。
3. **克制**:不要每轮都强制产出 observation。寒暄、纯工具调用、用户没暴露新信息的对话 → 返空数组 \`observations: []\`。
4. **观察粒度**:每条 observation 是**一句到一段话**的自然描述,不要写成"用户说 X"的复述,要写成观察者的**总结**(如:"内向倾向,需要独处充电")。
5. **context 字段**:可空。如果新对话明显是"在做某事"的场景(学某学科、改某稿件、聊某事件),写进 context;否则留空。
6. **current_view**:产出一份当前画像 markdown,按 4 个 topic 分段(空段写"(暂无)")。基于"最近 100 条已有 + 本轮新增"派生,用一两句简洁描述每段的当前认知。如果观察太少没法成形,可返空字符串。

## 输出格式(严格 JSON,无前后文字)

\`\`\`json
{
  "observations": [
    {"topic": "method", "observation": "学新概念偏先做最小例子再回看定义", "context": "聊学微分方程时"}
  ],
  "currentView": "## 身份\\n(暂无)\\n\\n## 性格\\n内向倾向。\\n\\n## 审美\\n散文偏冷峻。\\n\\n## 方法\\n学新概念偏先做最小例子。\\n"
}
\`\`\`

只输出 JSON,不要任何解释。`;

    const { text } = await generateText({ model, prompt });
    return extractJSON<ObserveLLMResult>(text);
  }

  // ─── 工具:topic label(给前端/prompt 用) ────────────────────

  static topicLabel(topic: ObservationTopic): string {
    return TOPIC_LABELS[topic];
  }
}
