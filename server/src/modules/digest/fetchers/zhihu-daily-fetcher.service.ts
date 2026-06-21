/**
 * ZhihuDailyFetcher — 知乎日报移动端 API（FetcherKind.zhihu_daily）。
 *
 * endpoint: https://news-at.zhihu.com/api/4/news/latest
 * config 期望：{}
 *
 * publishedAt 从响应顶层 date 字段（YYYYMMDD 格式）解析，所有 stories 同一天发布。
 * snippet 用 hint 字段（阅读时间/来源提示）。
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

const DEFAULT_LIMIT = 30;
const SNIPPET_MAX_LENGTH = 800;
const ENDPOINT = 'https://news-at.zhihu.com/api/4/news/latest';

interface ZhihuStory {
  id: number;
  title: string;
  url?: string;
  hint?: string;
  images?: string[];
}

interface ZhihuDailyResponse {
  date: string; // YYYYMMDD
  stories: ZhihuStory[];
}

/** YYYYMMDD → Date（UTC 0 点） */
function parseDateFromYYYYMMDD(raw: string): Date | undefined {
  if (!/^\d{8}$/.test(raw)) return undefined;
  const year = parseInt(raw.slice(0, 4), 10);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = parseInt(raw.slice(6, 8), 10);
  return new Date(Date.UTC(year, month, day));
}

@Injectable()
export class ZhihuDailyFetcher implements SourceFetcher {
  readonly kind = FetcherKind.zhihu_daily;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(ZhihuDailyFetcher.name);

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

    let data: ZhihuDailyResponse;
    try {
      data = await httpGetJson<ZhihuDailyResponse>(ENDPOINT, {
        label: source.name,
      });
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 date=${data.date} items=${data.stories?.length ?? 0} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`zhihu_daily: fetch failed - ${e.message}`);
    }

    const publishedAt = parseDateFromYYYYMMDD(data.date);

    const items: FetchedItem[] = data.stories.map((story) => ({
      itemGuid: `zhihu_daily_${story.id}`,
      title: story.title,
      url: story.url ?? `https://daily.zhihu.com/story/${story.id}`,
      publishedAt,
      snippet: (story.hint ?? '').slice(0, SNIPPET_MAX_LENGTH),
    }));

    // since 过滤（stories 同一天，一次性过滤即可）
    const afterSince = applyTimeWindow(items, since, until);

    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${data.stories.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}

function matchesAnyKeyword(item: FetchedItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
