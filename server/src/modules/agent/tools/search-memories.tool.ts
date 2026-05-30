import { tool, jsonSchema } from 'ai';
import type { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import {
  OBSERVATION_TOPICS,
  type ObservationTopic,
} from '../memory/agent-memory-observation.entity';
import { toolResult } from './tool-result';

/**
 * search_memories(2026-05-30 event log 重设,#150 续):跨主题关键词模糊搜 observations。
 *
 * 配合 prompt 顶部 <memories_index> 当前画像 + recall_memory(按主题深读):
 * 想找跟某个关键词相关的所有观察(可能跨身份/性格/审美/方法多类)时调这条。
 *
 * 契约对照 docs/agent-tools-redesign.md §1 + §2:
 * - summary = TL;DR(命中 N 条 + 头几条预览)
 * - detail  = 命中列表,每条:YYYY-MM-DD [topic] observation
 * - meta    = { status, total, shown, offset, hasMore, nextOffset, list }
 */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function createSearchMemoriesTool(
  observationRepo: AgentMemoryObservationRepository,
) {
  return tool({
    description:
      '关键词模糊搜跨主题的所有者观察(matches observation 字段 + context 字段)。' +
      '想找跟具体话题/事物相关的观察轨迹时用这条;想看某个 topic 的所有最近观察用 recall_memory。' +
      '可选 topic 过滤;截断时 meta 给 hasMore + nextOffset,可用 offset 续取。',
    inputSchema: jsonSchema<{
      query: string;
      topic?: ObservationTopic;
      limit?: number;
      offset?: number;
    }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '关键词(case-insensitive 模糊匹配 observation + context);空串则按时间倒序返全部',
        },
        topic: {
          type: 'string',
          enum: OBSERVATION_TOPICS as unknown as string[],
          description:
            '可选:限定在某个 topic 内搜(identity / personality / aesthetic / method / other)',
        },
        limit: {
          type: 'number',
          description: `单页条数,默认 ${DEFAULT_LIMIT},上限 ${MAX_LIMIT}`,
        },
        offset: {
          type: 'number',
          description: '续取偏移(对应上一页 meta.nextOffset),默认 0',
        },
      },
      required: ['query'],
    }),
    execute: async ({
      query,
      topic,
      limit,
      offset,
    }: {
      query: string;
      topic?: ObservationTopic;
      limit?: number;
      offset?: number;
    }) => {
      if (topic && !OBSERVATION_TOPICS.includes(topic)) {
        return toolResult(
          `topic 不合法,可选:${OBSERVATION_TOPICS.join(' / ')}(留空表示跨主题搜)`,
          undefined,
          { status: 'invalid' },
        );
      }
      const effLimit = Math.min(
        Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)),
        MAX_LIMIT,
      );
      const effOffset = Math.max(0, Math.floor(offset ?? 0));

      // 小数据量(<10k)直接内存过滤;若超 10k 再上 mongo text index。
      // 个人 KB 长期都不会到这量级,YAGNI。
      const allObservations = topic
        ? await observationRepo.findRecentByTopic(topic, 5000)
        : await observationRepo.findRecent(5000);
      const q = query.trim().toLowerCase();
      const matched = q
        ? allObservations.filter(
            (o) =>
              o.observation.toLowerCase().includes(q) ||
              (o.context && o.context.toLowerCase().includes(q)),
          )
        : allObservations;
      const total = matched.length;
      const page = matched.slice(effOffset, effOffset + effLimit);
      const shown = page.length;
      const nextOffset = effOffset + shown;
      const hasMore = nextOffset < total;

      if (total === 0) {
        return toolResult(
          q ? `没找到匹配「${query}」的观察` : '当前没有 observations',
          undefined,
          { status: 'not_found', total: 0 },
        );
      }

      const preview = page
        .slice(0, 3)
        .map((o) => o.observation.slice(0, 24))
        .join('、');
      const summary = q
        ? `命中 ${total} 条:${preview}${total > 3 ? ' …' : ''}`
        : `共 ${total} 条:${preview}${total > 3 ? ' …' : ''}`;
      const detail = page
        .map((o) => {
          const date = new Date(o.observedAt).toISOString().slice(0, 10);
          const ctx = o.context ? ` ⟨${o.context}⟩` : '';
          return `${date} [${o.topic}] ${o.observation}${ctx}`;
        })
        .join('\n');
      const list = page.map(
        (o) =>
          `${new Date(o.observedAt).toISOString().slice(0, 10)} · ${o.observation.slice(0, 40)}`,
      );

      return toolResult(summary, detail, {
        status: 'ok',
        total,
        shown,
        offset: effOffset,
        hasMore,
        nextOffset: hasMore ? nextOffset : undefined,
        list,
      });
    },
  });
}
