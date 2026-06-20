/**
 * get_recent_picks — 查询事项最近 N 天已推送过的条目（去重参考）。
 *
 * LLM 在决定是否 save_finding 之前可先查此工具，避免重复推送已推内容。
 * ProcessedFeedItemRepository.findRecentByTopic 支持 days / limit 参数。
 *
 * 铁律：0 条结果返回 ok + 空 list，不算失败；
 * meta.list 给前端 NestedList 渲染（标题 · 推送日期），不露 itemGuid。
 */
import { tool, jsonSchema } from 'ai';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import { toolResult } from '../../agent/tools/tool-result';

export interface GetRecentPicksDeps {
  pfiRepo: ProcessedFeedItemRepository;
}

export function createGetRecentPicksTool(deps: GetRecentPicksDeps) {
  const { pfiRepo } = deps;

  return tool({
    description:
      '查询该事项最近 N 天已推送过的条目列表，用于去重判断——若某 itemGuid 在列表中出现，应避免再次保存到本期报告。' +
      '返回 meta.picks 含 itemGuid、title、url、pickedAt；0 条为正常（说明近期无推送记录）。' +
      '确认无重复后，用 save_finding 保存本期挑选的条目。',
    inputSchema: jsonSchema<{ topicId: string; days?: number; limit?: number }>(
      {
        type: 'object',
        properties: {
          topicId: {
            type: 'string',
            description:
              '采集事项的 contentItemId（ci_xxx 格式），来自事项列表',
            examples: ['ci_26869a17d3fc'],
          },
          days: {
            type: 'number',
            description: '查多少天内的记录，默认 14 天，最多 60 天',
            minimum: 1,
            maximum: 60,
          },
          limit: {
            type: 'number',
            description: '返回条数上限，默认 20，最多 50',
            minimum: 1,
            maximum: 50,
          },
        },
        examples: [
          { topicId: 'ci_26869a17d3fc' },
          { topicId: 'ci_26869a17d3fc', days: 7, limit: 30 },
        ],
        required: ['topicId'],
      },
    ),
    execute: async ({
      topicId,
      days = 14,
      limit = 20,
    }: {
      topicId: string;
      days?: number;
      limit?: number;
    }) => {
      try {
        const picks = await pfiRepo.findRecentByTopic(topicId, days, limit);

        if (picks.length === 0) {
          return toolResult(`近 ${days} 天内无已推送记录`, undefined, {
            status: 'ok',
            total: 0,
            list: [],
            picks: [],
          });
        }

        const detail = picks
          .map(
            (p) =>
              `[${p.itemGuid}] ${p.title}\n  ${p.url}\n  推送时间: ${p.pickedAt.toISOString()}`,
          )
          .join('\n\n');

        // list 给前端 NestedList 渲染（标题 · 推送日期），不露 itemGuid
        const list = picks.map(
          (p) => `${p.title} · ${p.pickedAt.toISOString().slice(0, 10)} 已推`,
        );

        const pickList = picks.map((p) => ({
          itemGuid: p.itemGuid,
          title: p.title,
          url: p.url,
          pickedAt: p.pickedAt.toISOString(),
        }));

        return toolResult(
          `近 ${days} 天已推 ${picks.length} 条（去重参考）`,
          detail,
          { status: 'ok', total: picks.length, list, picks: pickList },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`查询已推送记录失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
