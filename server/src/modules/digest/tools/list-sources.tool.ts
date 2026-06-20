/**
 * list_sources — v3：列出本任务订阅的所有信息源，分配 ref（s1, s2...）。
 *
 * 设计决策：
 * - 不需要 topicId 参数：taskContext 已持有 topicId，LLM 无需显式传递（5 步法 Step 3：
 *   系统注入的隐式 context，LLM 在调用那一刻不需要知道它）。
 * - 每次调用会重新构建 sourceRefsMap（支持重复调用不累积脏数据）。
 * - description 教程化 + 透明：告知 LLM 这工具做什么、下一步该用什么。
 */
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../info-source.repository';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { InfoSource } from '../info-source.entity';
import { InfoSourceType } from '../info-source.entity';
import type { TaskContext } from './digest-tools.factory';
import { toolResult } from '../../agent/tools/tool-result';

export interface ListSourcesDeps {
  infoSourceRepo: InfoSourceRepository;
  stcRepo: SmartTopicConfigRepository;
  ctx: TaskContext;
}

function buildSourceDescription(source: InfoSource): string {
  const typeLabel =
    source.type === InfoSourceType.rss ? 'RSS 订阅' : source.type;
  return `${typeLabel}：${source.name}`;
}

export function createListSourcesTool(deps: ListSourcesDeps) {
  const { infoSourceRepo, stcRepo, ctx } = deps;

  return tool({
    description:
      '列出本任务订阅的所有信息源。每个源含 ref（临时引用号，agent 后续调 browse/search 用）、name、type、description（源大概是什么内容）。' +
      '先调这个工具看可用资源，再决定用 browse 浏览某源、或用 search 跨源搜关键词。',
    inputSchema: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
      examples: [{}],
    }),
    execute: async () => {
      try {
        const config = await stcRepo.findByContentItemId(ctx.topicId);
        if (!config || config.sourceIds.length === 0) {
          return toolResult('该事项暂未订阅任何信息源', undefined, {
            status: 'not_found',
            sources: [],
            list: [],
          });
        }

        const sources = await infoSourceRepo.findManyByIds(config.sourceIds);

        if (sources.length === 0) {
          return toolResult('该事项暂未订阅任何信息源', undefined, {
            status: 'not_found',
            sources: [],
            list: [],
          });
        }

        // 分配 ref：s1, s2, ...，写入 ctx.sourceRefsMap
        ctx.sourceRefsMap.clear();
        ctx.refCounter.source = 0;

        const items = sources.map((s) => {
          ctx.refCounter.source += 1;
          const ref = `s${ctx.refCounter.source}`;
          ctx.sourceRefsMap.set(ref, s);
          return {
            ref,
            name: s.name,
            type: s.type,
            description: buildSourceDescription(s),
          };
        });

        const n = items.length;
        return toolResult(`${n} 个可用信息源`, undefined, {
          status: 'ok',
          sources: items,
          list: items.map((s) => `${s.name}（${s.type}）`),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`列出信息源失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
