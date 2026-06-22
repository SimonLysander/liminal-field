/**
 * HnFirebaseFetcher — Hacker News Firebase API（FetcherKind.hn_firebase）。
 *
 * 流程：
 * 1. 取 topstories ID 列表（500 个）
 * 2. 截取前 N 个 ID（N = options.limit ?? 30）
 * 3. 并行 Promise.all 拉每条详情（每个 item GET 都加 10s timeout）
 *
 * endpoint:
 * - topstories: https://hacker-news.firebaseio.com/v0/topstories.json
 * - item detail: https://hacker-news.firebaseio.com/v0/item/<id>.json
 *
 * snippet 退化：item.text（HTML story text）→ `score=N by=xxx`
 * config 期望：{}
 */
import { Injectable, Logger } from '@nestjs/common';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';
import { httpGetJson, applyTimeWindow } from './http.utils';
import { matchesAnyKeyword } from './keyword-match.util';

const DEFAULT_LIMIT = 30;
const SNIPPET_MAX_LENGTH = 800;
const TOPSTORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ITEM_URL = (id: number) =>
  `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

interface HnItem {
  by?: string;
  id: number;
  score?: number;
  time: number;
  title?: string;
  url?: string;
  text?: string;
  type?: string;
}

@Injectable()
export class HnFirebaseFetcher implements SourceFetcher {
  readonly kind = FetcherKind.hn_firebase;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(HnFirebaseFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${TOPSTORIES_URL} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    // Step 1: 拉 topstories ID 列表
    let ids: number[];
    try {
      ids = await httpGetJson<number[]>(TOPSTORIES_URL, { label: source.name });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 topstories 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`hn_firebase: topstories fetch failed - ${e.message}`);
    }

    // Step 2: 截取前 limit 个
    const topIds = ids.slice(0, limit);

    // Step 3: 并行拉详情（httpGetJson 各自带 label，单条失败不阻塞整批）
    const rawItems = await Promise.all(
      topIds.map(async (id): Promise<HnItem | null> => {
        try {
          return await httpGetJson<HnItem>(ITEM_URL(id), {
            label: `${source.name}/item${id}`,
          });
        } catch {
          return null;
        }
      }),
    );

    this.logger.debug(
      `[fetch] 「${source.name}」 拉取完成 items=${rawItems.filter(Boolean).length} duration=${Date.now() - t0}ms`,
    );

    const items: FetchedItem[] = rawItems
      .filter((item): item is HnItem => item !== null && !!item.title)
      .map((item) => ({
        itemGuid: `hn_${item.id}`,
        title: item.title ?? '(无标题)',
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        publishedAt: new Date(item.time * 1000),
        // text 是 HTML，score/by 作为兜底 snippet
        snippet: (item.text
          ? stripHtml(item.text)
          : `score=${item.score ?? 0} by=${item.by ?? ''}`
        ).slice(0, SNIPPET_MAX_LENGTH),
      }));

    // 按发布时间倒序
    items.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    const afterSince = applyTimeWindow(items, since, until);

    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${items.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
