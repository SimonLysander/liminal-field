/**
 * ArxivFetcher — arXiv 官方 API 信息源拉取（FetcherKind.arxiv）。
 *
 * keywords 走「本地正则过滤」(与其余 fetcher 统一):拉 cat:<category> 最近一批,本地按正则筛
 * title+snippet。arxiv API 只认自有查询语法、收不了 JS 正则,故不再服务端 ti: 拼词。
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
import { matchesAnyKeyword } from './keyword-match.util';

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
  // keywords 走本地正则(全项目统一);arxiv API 收不了 JS 正则,不再服务端 ti:
  readonly supportsServerQuery = false;

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

    // arxiv 不收 JS 正则,只按分类拉最近一批,正则在本地筛(见下)。
    // 拉取量放大到至少 100:keywords 本地过滤前要有足够候选,否则只拉 limit(默认 30)条按时间排、正则筛完所剩无几。
    const fetchSize = Math.max(limit, 100);
    const searchQuery = `cat:${category}`;
    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${fetchSize}&sortBy=submittedDate&sortOrder=descending`;

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

    // keywords 本地正则过滤(与其余 fetcher 统一);无 keywords 则全留
    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${rawItems.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}

function parseDate(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
