/**
 * HfPapersFetcher — HuggingFace Daily Papers JSON API（FetcherKind.hf_papers）。
 *
 * endpoint: https://huggingface.co/api/daily_papers（无参数，返回当日精选论文列表）
 * config 期望：{}（无需任何 config）
 *
 * 解析：纯 JSON，无需 rss-parser。
 * keywords 本地过滤（supportsServerQuery=false）。
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
const ENDPOINT = 'https://huggingface.co/api/daily_papers';

interface HfPaperItem {
  paper: {
    id: string;
    title: string;
    summary?: string;
    publishedAt: string;
    upvotes?: number;
  };
  title?: string;
}

@Injectable()
export class HfPapersFetcher implements SourceFetcher {
  readonly kind = FetcherKind.hf_papers;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(HfPapersFetcher.name);

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

    let rawData: HfPaperItem[];
    try {
      rawData = await httpGetJson<HfPaperItem[]>(ENDPOINT, {
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
      throw new Error(`hf_papers: fetch failed - ${e.message}`);
    }

    const items: FetchedItem[] = rawData.map((entry) => ({
      itemGuid: `arxiv:${entry.paper.id}`,
      title: entry.paper.title,
      url: `https://huggingface.co/papers/${entry.paper.id}`,
      publishedAt: new Date(entry.paper.publishedAt),
      snippet: (entry.paper.summary ?? '').slice(0, SNIPPET_MAX_LENGTH),
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
