/**
 * V2exFetcher — V2EX 官方 API（FetcherKind.v2ex）。
 *
 * endpoint: https://www.v2ex.com/api/topics/latest.json
 * config 期望：{}（无需任何 config）
 * 响应：JSON 数组，每条含 id/title/url/content/created（unix 秒）等字段。
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
const ENDPOINT = 'https://www.v2ex.com/api/topics/latest.json';

interface V2exTopic {
  id: number;
  title: string;
  url: string;
  content?: string;
  created: number;
  node?: { name: string; title: string };
}

@Injectable()
export class V2exFetcher implements SourceFetcher {
  readonly kind = FetcherKind.v2ex;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(V2exFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${ENDPOINT} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let rawData: V2exTopic[];
    try {
      rawData = await httpGetJson<V2exTopic[]>(ENDPOINT, {
        label: source.name,
      });
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 items=${rawData.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`v2ex: fetch failed - ${e.message}`);
    }

    const items: FetchedItem[] = rawData.map((topic) => ({
      itemGuid: `v2ex_${topic.id}`,
      title: topic.title,
      url: topic.url,
      publishedAt: new Date(topic.created * 1000),
      snippet: (topic.content ?? '').slice(0, SNIPPET_MAX_LENGTH),
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
      `[fetch] 「${source.name}」 完成 total=${rawData.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}
