import { tool, jsonSchema } from 'ai';
import type { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import {
  OBSERVATION_TOPICS,
  type ObservationTopic,
} from '../memory/agent-memory-observation.entity';
import { toolResult } from './tool-result';

/**
 * remember(2026-05-30 event log 重设,#150 续):
 * 主 agent 批量记下值得长期保留的觉察。
 *
 * 设计:
 * - append-only 岁月史书,只增不改不删(无 forget,无 update)
 * - 主 agent 主动调(它在对话现场最懂"该不该记"),不是后台自动跑
 * - 史书格式:长 context(背景) + 短 observation(判断)
 * - 强校验字数:整批 reject + 友好 invalid 回执,让模型重写到位
 *
 * 触发 view refresh 不在工具内:onAfterChat 钩子按"7 天 OR 累积 15 条"独立判断。
 */
const OBSERVATION_MAX_CHARS = 120;
const CONTEXT_MAX_CHARS = 300;
const MAX_BATCH = 10;

export function createRememberTool(
  observationRepo: AgentMemoryObservationRepository,
  sessionKey?: string,
) {
  return tool({
    description: [
      'remember:批量记下值得长期保留的觉察(append-only 岁月史书,只增不改不删)。',
      '',
      '每条由两块组成,合起来像史书的一条:',
      '',
      '- topic 必填,5 选 1:',
      '    identity     身份(职业 / 教育 / 居住 / 语言文化)',
      '    personality  性格(性格特质 / 价值观 / 思维倾向 / 当下心境)',
      '    aesthetic    审美(觉得什么好 / 美 / 对的跨场景品味判断)',
      '    method       方法(怎么做事 / 思维模型 / 流程 / 节奏 / 工具)',
      '    other        兜底,谨慎用',
      '',
      '- context 可选,≤ 300 字,**详写背景**——那段对话聊什么、TA 做了什么动作 / 选择、TA 怎么解释自己的选择、张力反差。',
      '  让未来的你看到 context 就能复原现场,理解 observation 的判断从何而来。',
      "  ✅ \"改一段技术笔记时,他先连删三条 inline 注释,其中一条是别人为他写的清晰解释,说'反而像替我念';段间总结也划掉,但保留了一个'TODO 这里有个坑'的警示——删的是解释,留的是警示。\"",
      '  ❌ "聊代码风格时"(没信息量,等于没说)',
      '',
      '- observation 必填,≤ 120 字,**简短判断/取向**(类似太史公曰):',
      '  ✅ "代码注释偏极简——删解释留警示。冗余像替读者念词。"',
      '  ✅ "学新概念偏造最小例子再看定义,费曼式\'造而后悟\'。"',
      '  ❌ 复述 context 里的事实(observation 是判断,不是事实)',
      '  ❌ 长篇大论(超 120 字说明 context 没写够,把细节挪回 context)',
      '',
      '何时调:用户暴露**新长期信号**时(新事 / 新观点 / 新偏好 / 新身份)。',
      '何时不调:寒暄 / 纯工具调用 / 重复信号 / 不确定。**宁少勿滥**。',
      '',
      '一句话暴露多面信号(身份 + 审美 + 方法)→ 拆成多条 observation,各管一面 topic。',
      '',
      '调完**不要**在回复里 acknowledge("我记下了"),继续自然对话——塑形是潜意识动作。',
      '',
      '超字数 / 非法 topic → 整批 reject + invalid 回执,需重写。',
    ].join('\n'),
    inputSchema: jsonSchema<{
      observations: Array<{
        topic: ObservationTopic;
        observation: string;
        context?: string;
      }>;
    }>({
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BATCH,
          items: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                enum: OBSERVATION_TOPICS as unknown as string[],
              },
              observation: { type: 'string' },
              context: { type: 'string' },
            },
            required: ['topic', 'observation'],
          },
        },
      },
      required: ['observations'],
    }),
    execute: async ({
      observations,
    }: {
      observations: Array<{
        topic: ObservationTopic;
        observation: string;
        context?: string;
      }>;
    }) => {
      // ─── 强校验 ─────────────────────────────────────────
      if (!Array.isArray(observations) || observations.length === 0) {
        return toolResult('observations 必须是非空数组', undefined, {
          status: 'invalid',
        });
      }
      if (observations.length > MAX_BATCH) {
        return toolResult(
          `一次最多 ${MAX_BATCH} 条,实际 ${observations.length} 条;拆开调或精简`,
          undefined,
          { status: 'invalid' },
        );
      }
      for (const [i, obs] of observations.entries()) {
        if (!OBSERVATION_TOPICS.includes(obs.topic)) {
          return toolResult(
            `第 ${i + 1} 条 topic 不合法,5 选 1: identity / personality / aesthetic / method / other`,
            undefined,
            { status: 'invalid' },
          );
        }
        if (
          typeof obs.observation !== 'string' ||
          obs.observation.trim().length === 0
        ) {
          return toolResult(
            `第 ${i + 1} 条 observation 必填且不能空`,
            undefined,
            { status: 'invalid' },
          );
        }
        if (obs.observation.length > OBSERVATION_MAX_CHARS) {
          return toolResult(
            `第 ${i + 1} 条 observation 超过 ${OBSERVATION_MAX_CHARS} 字(实际 ${obs.observation.length}),凝练成简短判断;长细节挪回 context`,
            undefined,
            { status: 'invalid' },
          );
        }
        if (obs.context && obs.context.length > CONTEXT_MAX_CHARS) {
          return toolResult(
            `第 ${i + 1} 条 context 超过 ${CONTEXT_MAX_CHARS} 字(实际 ${obs.context.length}),史书条目精简到一段话之内`,
            undefined,
            { status: 'invalid' },
          );
        }
      }

      // ─── 全过 → 批量 append ──────────────────────────────
      const items = observations.map((obs) => ({
        topic: obs.topic,
        observation: obs.observation.trim(),
        context: obs.context?.trim(),
        sessionKey,
      }));
      const created = await observationRepo.appendMany(items);

      // ack:模型私下知道 + 前端 ToolCallCard 低调显示 "Note Memory · N 条"
      const topicCount = items.reduce<Record<string, number>>((acc, i) => {
        acc[i.topic] = (acc[i.topic] ?? 0) + 1;
        return acc;
      }, {});
      const summary = `记下 ${created.length} 条 · ${Object.entries(topicCount)
        .map(([t, n]) => `${t}×${n}`)
        .join(' / ')}`;
      return toolResult(summary, undefined, {
        status: 'ok',
        added: created.length,
        // 砍掉 observationIds:Mongoose insertMany 返回 Document instance 上 _id 取不到,
        // 且模型/UI 都不需要 — 模型靠 list 看记了啥,UI 靠 added/list 渲染卡片
        // list 给前端 NestedList(⎿ 对齐渲染),每条一行
        list: items.map(
          (i) =>
            `[${i.topic}] ${i.observation.slice(0, 24)}${i.observation.length > 24 ? '…' : ''}`,
        ),
      });
    },
  });
}
