/**
 * ArxivFetcher — arXiv 官方 API 信息源拉取（FetcherKind.arxiv）。
 *
 * supportsServerQuery=true：keywords 直接拼进 ti:... AND cat:... query 参数，
 * 命中范围覆盖历史数据而非仅最近窗口（不同于 RSS 类 fetcher 的本地过滤）。
 *
 * endpoint: http://export.arxiv.org/api/query?search_query=...&start=0&max_results=N&sortBy=submittedDate&sortOrder=descending
 * http:// 会 301 → https://，rss-parser 默认跟随 redirect。
 *
 * 解析：rss-parser 复用（arxiv API 输出标准 Atom XML，与 RSS 共享同一解析路径）。
 * config 期望：{ category: 'cs.AI' | 'cs.LG' | 'cs.CL' }
 */
import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';
import { applyTimeWindow } from './http.utils';

const DEFAULT_LIMIT = 30;
const SNIPPET_MAX_LENGTH = 800;
const DEFAULT_UA = 'Mozilla/5.0 (LimialFieldBot/1.0)';

type ArxivEntry = {
  id?: string;
  link?: string;
  title?: string;
  summary?: string;
  published?: string;
  isoDate?: string;
};

@Injectable()
export class ArxivFetcher implements SourceFetcher {
  readonly kind = FetcherKind.arxiv;
  // keywords 拼进 server 端 query，命中历史范围；本地不再二次过滤
  readonly supportsServerQuery = true;

  private readonly logger = new Logger(ArxivFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const cfg = source.config as { category?: string };
    const category = cfg?.category ?? 'cs.AI';
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    // keywords 拼进 server 端 query（title 字段，OR 语义，空格用 +）
    let searchQuery: string;
    if (keywords && keywords.length > 0) {
      const tiPart = keywords
        .map((k) => `ti:${k.replace(/\s+/g, '+')}`)
        .join('+OR+');
      searchQuery = `(${tiPart})+AND+cat:${category}`;
    } else {
      searchQuery = `cat:${category}`;
    }

    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${url} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    // rss-parser 内置 http(s) 跟随 redirect（arxiv http → https 301）
    const parser = new Parser<Record<string, unknown>, ArxivEntry>({
      customFields: {
        item: [
          ['summary', 'summary'],
          ['published', 'published'],
        ],
      },
      requestOptions: { headers: { 'User-Agent': DEFAULT_UA } },
    });

    let rawItems: (Parser.Item & ArxivEntry)[];
    try {
      const feed = await parser.parseURL(url);
      // feed.items 的类型已含自定义字段（ArxivEntry），直接赋值（不需要 cast）
      rawItems = feed.items;
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 items=${rawItems.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 parseURL 失败 url=${url} err=${e.message}`,
        e.stack,
      );
      throw new Error(`arxiv: fetch failed - ${e.message}`);
    }

    const items: FetchedItem[] = rawItems.map((entry) => {
      // arxiv entry.id 是完整 URL，直接用作 guid
      const itemGuid = entry.id ?? entry.link ?? '';
      const publishedAt = parseDate(entry.isoDate ?? entry.published);
      const snippet = (entry.summary ?? '').slice(0, SNIPPET_MAX_LENGTH);

      return {
        itemGuid,
        title: entry.title ?? '(无标题)',
        url: entry.link ?? itemGuid,
        publishedAt,
        snippet,
      };
    });

    // 按发布时间倒序
    items.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    // since 过滤
    const afterSince = applyTimeWindow(items, since, until);

    // supportsServerQuery=true → keywords 已传给 server，不在本地二次过滤
    const result = afterSince.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${rawItems.length} afterSince=${afterSince.length} returned=${result.length}`,
    );
    return result;
  }
}

function parseDate(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
