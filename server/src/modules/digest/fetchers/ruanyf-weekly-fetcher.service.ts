/**
 * RuanyfWeeklyFetcher — 阮一峰科技爱好者周刊（GitHub Issues 自荐池，FetcherKind.ruanyf_weekly）。
 *
 * endpoint: https://api.github.com/repos/ruanyf/weekly/issues?state=open&per_page=<limit>
 * config 期望：{}
 *
 * 请求头需要 Accept: application/vnd.github+json + UA。
 * snippet = body（截 800），无 body 时为空字符串。
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

interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  body?: string;
}

@Injectable()
export class RuanyfWeeklyFetcher implements SourceFetcher {
  readonly kind = FetcherKind.ruanyf_weekly;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(RuanyfWeeklyFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    const url = `https://api.github.com/repos/ruanyf/weekly/issues?state=open&per_page=${limit}`;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${url} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let rawData: GithubIssue[];
    try {
      rawData = await httpGetJson<GithubIssue[]>(url, {
        label: source.name,
        headers: { Accept: 'application/vnd.github+json' },
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
      throw new Error(`ruanyf_weekly: fetch failed - ${e.message}`);
    }

    const items: FetchedItem[] = rawData.map((issue) => ({
      itemGuid: `ruanyf_${issue.number}`,
      title: issue.title,
      url: issue.html_url,
      publishedAt: new Date(issue.created_at),
      snippet: (issue.body ?? '').slice(0, SNIPPET_MAX_LENGTH),
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

function matchesAnyKeyword(item: FetchedItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
