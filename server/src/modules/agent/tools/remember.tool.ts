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

/** observations 入参的类型，供 validateObservations / toObservationItems 共用 */
export type ObservationInput = Array<{
  topic: ObservationTopic;
  observation: string;
  context?: string;
}>;

/**
 * 强校验 observations 数组（写前防御）。
 * 返回错误文案（整批 reject）或 null（全过）。
 * 提取为独立函数供 HITL commit 路径复用，行为与 execute 内完全等价。
 */
export function validateObservations(
  observations: ObservationInput,
): string | null {
  if (!Array.isArray(observations) || observations.length === 0) {
    return 'observations 必须是非空数组';
  }
  if (observations.length > MAX_BATCH) {
    return `一次最多 ${MAX_BATCH} 条,实际 ${observations.length} 条;拆开调或精简`;
  }
  for (const [i, obs] of observations.entries()) {
    if (!OBSERVATION_TOPICS.includes(obs.topic)) {
      return `第 ${i + 1} 条 topic 不合法,5 选 1: identity / personality / aesthetic / method / other`;
    }
    if (
      typeof obs.observation !== 'string' ||
      obs.observation.trim().length === 0
    ) {
      return `第 ${i + 1} 条 observation 必填且不能空`;
    }
    if (obs.observation.length > OBSERVATION_MAX_CHARS) {
      return `第 ${i + 1} 条 observation 超过 ${OBSERVATION_MAX_CHARS} 字(实际 ${obs.observation.length}),凝练成简短判断;长细节挪回 context`;
    }
    if (obs.context && obs.context.length > CONTEXT_MAX_CHARS) {
      return `第 ${i + 1} 条 context 超过 ${CONTEXT_MAX_CHARS} 字(实际 ${obs.context.length}),史书条目精简到一段话之内`;
    }
  }
  return null;
}

/**
 * 将 observations 数组 map 成 appendMany 的入参格式（trim + 带 sessionKey）。
 * 提取为独立函数供 HITL commit 路径复用。
 */
export function toObservationItems(
  observations: ObservationInput,
  sessionKey?: string,
) {
  return observations.map((obs) => ({
    topic: obs.topic,
    observation: obs.observation.trim(),
    context: obs.context?.trim(),
    sessionKey,
  }));
}

export function createRememberTool(
  observationRepo: AgentMemoryObservationRepository,
  sessionKey?: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
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
    execute: async ({ observations }: { observations: ObservationInput }) => {
      // ─── 强校验（提取到 validateObservations，commit 路径复用） ──────────────
      const validationErr = validateObservations(observations);
      if (validationErr != null) {
        return toolResult(validationErr, undefined, { status: 'invalid' });
      }

      // ─── 全过 → 批量 append ──────────────────────────────
      const items = toObservationItems(observations, sessionKey);
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
