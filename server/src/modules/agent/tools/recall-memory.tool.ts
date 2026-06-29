import { tool, jsonSchema } from 'ai';
import type { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import {
  OBSERVATION_TOPICS,
  type ObservationTopic,
} from '../memory/agent-memory-observation.entity';
import { toolResult } from './tool-result';

/**
 * recall_memory(2026-05-30 event log 重设,#150 续):按 topic 深读最近 N 条观察。
 *
 * 配合 prompt 顶部 <memories_index> 当前画像——画像是 LLM 派生的摘要,
 * 要看某个维度下"具体观察到了什么、什么时候观察的、跨多长时间",调这条按 topic 拉时间序列。
 *
 * 契约:
 * - summary = TL;DR("身份 · 最近 8 条 · 横跨 2024-01 → 2026-05")
 * - detail  = 时间序列文本(YYYY-MM-DD: observation ⟨context⟩)
 * - meta    = { status, topic, total, shown, list }
 *
 * 跟 search_memories 分工:
 * - recall_memory:**主题驱动**(深读"性格"这一类的所有最近观察)
 * - search_memories:**关键词驱动**(找跟"摄影"相关的跨主题观察)
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createRecallMemoryTool(
  observationRepo: AgentMemoryObservationRepository,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{ topic: ObservationTopic; limit?: number }>({
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: OBSERVATION_TOPICS as unknown as string[],
          description:
            'identity / personality / aesthetic / method / other —— 详见 <memories_index> 上下文,从 5 类里精确选一个',
        },
        limit: {
          type: 'number',
          description: `单次返回上限,默认 ${DEFAULT_LIMIT},上限 ${MAX_LIMIT}`,
        },
      },
      required: ['topic'],
    }),
    execute: async ({
      topic,
      limit,
    }: {
      topic: ObservationTopic;
      limit?: number;
    }) => {
      if (!OBSERVATION_TOPICS.includes(topic)) {
        return toolResult(
          `topic 必须是 5 选 1:${OBSERVATION_TOPICS.join(' / ')}`,
          undefined,
          { status: 'invalid' },
        );
      }
      const effLimit = Math.min(
        Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)),
        MAX_LIMIT,
      );
      const observations = await observationRepo.findRecentByTopic(
        topic,
        effLimit,
      );
      if (observations.length === 0) {
        return toolResult(
          `${topicLabel(topic)} 主题下暂无观察记录`,
          undefined,
          { status: 'not_found', topic, total: 0 },
        );
      }

      // 时间序列正序展示(早→晚),让模型看到轨迹
      const ordered = [...observations].reverse();
      const detailLines = ordered.map((o) => {
        const date = new Date(o.observedAt).toISOString().slice(0, 10);
        const ctx = o.context ? ` ⟨${o.context}⟩` : '';
        return `${date}: ${o.observation}${ctx}`;
      });
      const detail = detailLines.join('\n');
      const list = ordered.map(
        (o) =>
          `${new Date(o.observedAt).toISOString().slice(0, 10)} · ${o.observation.slice(0, 40)}`,
      );
      const firstDate = new Date(ordered[0].observedAt)
        .toISOString()
        .slice(0, 10);
      const lastDate = new Date(ordered[ordered.length - 1].observedAt)
        .toISOString()
        .slice(0, 10);
      const summary =
        ordered.length === 1
          ? `${topicLabel(topic)} · 1 条 · ${firstDate}`
          : `${topicLabel(topic)} · ${ordered.length} 条 · 横跨 ${firstDate} → ${lastDate}`;

      return toolResult(summary, detail, {
        status: 'ok',
        topic,
        total: ordered.length,
        shown: ordered.length,
        list,
      });
    },
  });
}

function topicLabel(topic: ObservationTopic): string {
  switch (topic) {
    case 'identity':
      return '身份';
    case 'personality':
      return '性格';
    case 'aesthetic':
      return '审美';
    case 'method':
      return '方法';
    case 'other':
    default:
      return '其他';
  }
}
