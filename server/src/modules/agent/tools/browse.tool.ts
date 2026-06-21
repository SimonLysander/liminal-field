/**
 * browse — v5：多源并行扫订阅信箱。
 *
 * 新签名 `{ sourceIds?, keywords?, limit? }`（v4 → v5 关键升级）：
 * - 不传 sourceIds → 默认扫当前事项订阅的全部 enabled 源（由 ctx.topicId 反查 SmartTopicConfig）
 * - 传 sourceIds → 锁定子集（agent 主动收窄）
 * - keywords[] → 透传 fetcher 内部:
 *     · supportsServerQuery=true (arxiv) → 拼进 query 命中历史
 *     · supportsServerQuery=false (其他) → 本地 title+snippet OR 过滤最近窗口
 *   对 agent 完全透明
 *
 * 行为：
 * - FetcherRegistry.fetchMany 并行打所有目标源,Promise.allSettled 单源失败不挂整次
 * - 合并所有源条目 → 历史去重 (ProcessedFeedItem) → 按 publishedAt desc 排 → cap limit
 * - 每条分配 ref (i1, i2...) 写入 ctx.fetchedItemsMap,pick 工具靠 ref 反查
 *
 * 失败处理：
 * - 0 源命中 + 部分源失败 → status=error + errorCode=ALL_SOURCES_FAILED + 列出失败源
 * - 部分源成功 → status=partial(返成功条目 + meta.failedSources 标注)
 * - 全成功 → status=ok
 *
 * 边界:
 * - sourceIds 含禁用 / 不存在的 id → 在结果 meta 里标 invalid/disabled,不让整次挂
 * - ctx.topicId 对应的 SmartTopicConfig 不存在 → 兜底空数组,告诉 agent "事项无订阅源"
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import type { InfoSourceRepository } from '../../digest/info-source.repository';
import type { FetcherRegistry } from '../../digest/fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../../digest/processed-feed-item.repository';
import type { SmartTopicConfigRepository } from '../../digest/smart-topic-config.repository';
import type { InfoSource } from '../../digest/info-source.entity';
import type { DigestTaskContext } from './digest-task-context';
import { toolResult } from './tool-result';

const logger = new Logger('browse');

// agent 不传 since 时的兜底窗口(防漏传整次 fail)。
// 正常应由 react-agent 在 prompt 里告诉 agent "本期收集窗口",agent 显式传。
const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export interface BrowseDeps {
  infoSourceRepo: InfoSourceRepository;
  smartTopicConfigRepo: SmartTopicConfigRepository;
  fetcherRegistry: FetcherRegistry;
  pfiRepo: ProcessedFeedItemRepository;
  ctx: DigestTaskContext;
}

export function createBrowseTool(deps: BrowseDeps) {
  const {
    infoSourceRepo,
    smartTopicConfigRepo,
    fetcherRegistry,
    pfiRepo,
    ctx,
  } = deps;

  return tool({
    description:
      '扫订阅信箱,并行拉全部(或指定)订阅源在 since/until 窗口内的条目。' +
      '不传 sourceIds 默认扫当前事项订阅的所有源;' +
      'since/until 是本期收集窗口(ISO 8601 字符串),由 system prompt 给出,务必传;' +
      'keywords 传一个或多个关键词时,工具会尽力按相关性过滤(部分源支持服务端检索命中历史,' +
      '其他源仅本地过滤最近窗口)。' +
      '已历史去重(剔除本期 findings 已收录的)。' +
      '返回 items 含 ref(i1, i2...)、title、url、publishedAt、snippet。' +
      '搜索具体关键词找全网历史时,改用 web_search。',
    inputSchema: jsonSchema<{
      sourceIds?: string[];
      keywords?: string[];
      since?: string;
      until?: string;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        sourceIds: {
          type: 'array',
          items: { type: 'string', examples: ['src_abc123'] },
          description:
            '可选,锁定要扫的源子集;不传时默认扫当前事项订阅的全部启用源',
        },
        keywords: {
          type: 'array',
          items: { type: 'string', examples: ['transformer', 'MoE'] },
          description:
            '可选,关键词过滤(OR 语义,不区分大小写)。能服务端 query 的源(arxiv)走 server,其他源本地过滤最近窗口',
        },
        since: {
          type: 'string',
          description:
            '本期窗口起点(ISO 8601,如 "2026-06-20T08:00:00Z")。从 system prompt 复制,不传则兜底过去 7 天',
          examples: ['2026-06-20T08:00:00Z'],
        },
        until: {
          type: 'string',
          description:
            '本期窗口终点(ISO 8601)。从 system prompt 复制,不传则默认现在',
          examples: ['2026-06-21T08:00:00Z'],
        },
        limit: {
          type: 'number',
          description: '最多返回多少条(合并去重后),1-100,默认 30',
        },
      },
      examples: [
        {
          since: '2026-06-20T08:00:00Z',
          until: '2026-06-21T08:00:00Z',
        },
        {
          keywords: ['MoE routing'],
          since: '2026-06-20T08:00:00Z',
          until: '2026-06-21T08:00:00Z',
        },
        {
          sourceIds: ['src_abc123'],
          keywords: ['transformer'],
          since: '2026-06-20T08:00:00Z',
          until: '2026-06-21T08:00:00Z',
        },
      ],
    }),
    execute: async (input: {
      sourceIds?: string[];
      keywords?: string[];
      since?: string;
      until?: string;
      limit?: number;
    }) => {
      const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const keywords = input.keywords?.filter((k) => k && k.trim().length > 0);
      // 解析 since/until ISO 字符串;无效或没传 → 走兜底
      const since = parseIsoOrFallback(
        input.since,
        new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000),
      );
      const until = parseIsoOrFallback(input.until, new Date());

      try {
        // ── Step 1: 决定要扫哪些源 ──────────────────────────────────────────
        let targetSources: InfoSource[] = [];
        const invalidIds: string[] = [];
        const disabledIds: string[] = [];

        if (input.sourceIds && input.sourceIds.length > 0) {
          // agent 显式锁定子集:每个 id 都查 DB,记下 invalid / disabled
          const queried = await infoSourceRepo.findManyByIds(input.sourceIds);
          const queriedMap = new Map(queried.map((s) => [String(s._id), s]));
          for (const id of input.sourceIds) {
            const src = queriedMap.get(id);
            if (!src) {
              invalidIds.push(id);
              continue;
            }
            if (!src.enabled) {
              disabledIds.push(id);
              continue;
            }
            targetSources.push(src);
          }
        } else {
          // 默认:扫当前事项订阅的全部 enabled 源
          const stc = await smartTopicConfigRepo.findByContentItemId(
            ctx.topicId,
          );
          if (!stc || stc.sourceIds.length === 0) {
            return toolResult(
              '本事项暂无订阅源,改用 web_search 找相关内容',
              undefined,
              {
                status: 'error',
                errorCode: 'NO_SUBSCRIBED_SOURCES',
                topicId: ctx.topicId,
              },
            );
          }
          const all = await infoSourceRepo.findManyByIds(stc.sourceIds);
          targetSources = all.filter((s) => s.enabled);
        }

        if (targetSources.length === 0) {
          return toolResult(
            '没有可扫的启用源(全部 disabled / invalid)',
            undefined,
            {
              status: 'error',
              errorCode: 'NO_ENABLED_SOURCES',
              invalidIds,
              disabledIds,
            },
          );
        }

        // ── Step 2: 多源并行 fetch ───────────────────────────────────────────
        const fetchResults = await fetcherRegistry.fetchMany(targetSources, {
          since,
          until,
          keywords,
        });

        // 按源拆 ok / failed,失败源只走 meta.failedSources 不阻塞整次
        const failedSources = fetchResults
          .filter((r) => r.status === 'failed')
          .map((r) => ({
            id: String(r.source._id),
            name: r.source.name,
            error: r.error,
          }));

        // 合并所有成功源的条目,带上 sourceId/sourceName 信息(后续 ref 包装要用)
        type Enriched = {
          fetchedItem: (typeof fetchResults)[number]['items'][number];
          sourceId: string;
          sourceName: string;
        };
        const allItems: Enriched[] = fetchResults
          .filter((r) => r.status === 'ok')
          .flatMap((r) =>
            r.items.map(
              (it): Enriched => ({
                fetchedItem: it,
                sourceId: String(r.source._id),
                sourceName: r.source.name,
              }),
            ),
          );

        // ALL_SOURCES_FAILED 判定:**必须所有目标源都 failed** 才整次 error。
        // 之前的逻辑 `allItems===0 && failed>0` 是 bug —— 6 源 fetch 成功但
        // 窗口内 0 条(预期行为)+ 1 源 SSL 失败,会被误判成"所有源失败,改用 web_search",
        // 让 agent 误以为订阅圈整体挂了。正确语义:
        //   - 全部源 failed → 整次 error(实际抓取失败,需 web_search 兜底)
        //   - 部分源 failed,其他 0 条      → status='ok' 正常返回(窗口内确实没新东西)
        //   - 全部源 ok 但 0 条            → status='ok'(同上)
        if (
          failedSources.length === targetSources.length &&
          targetSources.length > 0
        ) {
          return toolResult(
            `全部 ${failedSources.length} 个目标源都抓取失败,改用 web_search`,
            undefined,
            {
              status: 'error',
              errorCode: 'ALL_SOURCES_FAILED',
              failedSources,
            },
          );
        }

        // ── Step 3: 历史去重(本期 findings 已收录的 itemGuid 剔掉)─────────────
        const existingGuids = await pfiRepo.findExistingGuids(
          ctx.topicId,
          allItems.map((e) => e.fetchedItem.itemGuid),
        );
        const existingSet = new Set(existingGuids);
        const deduped = allItems.filter(
          (e) => !existingSet.has(e.fetchedItem.itemGuid),
        );

        // 按 publishedAt 倒序(无时间的排末尾),再 cap limit
        deduped.sort((a, b) => {
          const ta = a.fetchedItem.publishedAt?.getTime() ?? 0;
          const tb = b.fetchedItem.publishedAt?.getTime() ?? 0;
          return tb - ta;
        });
        const capped = deduped.slice(0, limit);

        // ── Step 4: 分配 ref + 写 ctx.fetchedItemsMap ───────────────────────
        const items = capped.map(({ fetchedItem, sourceId, sourceName }) => {
          ctx.refCounter.item += 1;
          const ref = `i${ctx.refCounter.item}`;
          ctx.fetchedItemsMap.set(ref, { fetchedItem, sourceId, sourceName });
          return {
            ref,
            sourceName,
            title: fetchedItem.title,
            url: fetchedItem.url,
            publishedAt: fetchedItem.publishedAt?.toISOString(),
            snippet: fetchedItem.snippet.slice(0, 200),
          };
        });

        // 按源汇总命中条数(agent 看一眼就知道哪些源贡献多)
        const perSourceCounts = fetchResults
          .filter((r) => r.status === 'ok')
          .map((r) => ({
            id: String(r.source._id),
            name: r.source.name,
            count: r.items.length,
            durationMs: r.durationMs,
          }));

        const status =
          failedSources.length > 0 || invalidIds.length > 0 ? 'partial' : 'ok';

        const summaryParts: string[] = [
          `扫 ${targetSources.length} 源,合并 ${allItems.length} 条`,
        ];
        if (existingSet.size > 0) {
          summaryParts.push(`历史去重 ${existingSet.size}`);
        }
        if (failedSources.length > 0) {
          summaryParts.push(`失败 ${failedSources.length} 源`);
        }
        if (keywords && keywords.length > 0) {
          summaryParts.push(`关键词 [${keywords.join('|')}]`);
        }
        summaryParts.push(`返回 ${items.length} 条`);

        logger.debug(
          `browse: targets=${targetSources.length} merged=${allItems.length} deduped=${deduped.length} returned=${items.length} failed=${failedSources.length} taskId=${ctx.taskId}`,
        );

        return toolResult(summaryParts.join(' · '), undefined, {
          status,
          since: since.toISOString(),
          until: until.toISOString(),
          totalFetched: allItems.length,
          afterDedupe: deduped.length,
          returned: items.length,
          items,
          perSourceCounts,
          failedSources: failedSources.length > 0 ? failedSources : undefined,
          invalidIds: invalidIds.length > 0 ? invalidIds : undefined,
          disabledIds: disabledIds.length > 0 ? disabledIds : undefined,
          list: items.slice(0, 8).map((i) => `${i.title} · ${i.sourceName}`),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `browse 异常 taskId=${ctx.taskId} msg=${msg}`,
          err instanceof Error ? err.stack : undefined,
        );
        return toolResult(`browse 失败: ${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}

/** ISO 8601 解析;无效/空返 fallback */
function parseIsoOrFallback(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? fallback : d;
}
